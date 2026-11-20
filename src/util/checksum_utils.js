/* Copyright (C) 2016 NooBaa */
'use strict';

const crypto = require('crypto');
const { RpcError } = require('../rpc');

// Currently only SHA-512 is supported.
// To add a new algorithm: add it to S3_CHECKSUM_ALGORITHM and update
// parse/header functions below.
const S3_CHECKSUM_ALGORITHM = Object.freeze({
    SHA512: 'sha512',
});

const SHA512_DIGEST_BYTES = 64;

const S3_CHECKSUM_ALGORITHM_HEADER = 'x-amz-checksum-algorithm';
const S3_SDK_CHECKSUM_ALGORITHM_HEADER = 'x-amz-sdk-checksum-algorithm';
const S3_CHECKSUM_SHA512_HEADER = 'x-amz-checksum-sha512';
const S3_CHECKSUM_TYPE_HEADER = 'x-amz-checksum-type';

const CHECKSUM_TYPE = Object.freeze({
    FULL_OBJECT: 'FULL_OBJECT',
    COMPOSITE: 'COMPOSITE',
});

/**
 * @param {string} algorithm
 * @throws {Error} if algorithm is not supported
 */
function validate_checksum_algorithm(algorithm) {
    if (!algorithm) return;
    if (!Object.hasOwn(S3_CHECKSUM_ALGORITHM, algorithm)) {
        throw new Error(`Unsupported checksum algorithm: ${algorithm}. Supported: ${Object.keys(S3_CHECKSUM_ALGORITHM).join(', ')}`);
    }
}

/**
 * @param {object} req - S3 request with .headers
 * @returns {{ checksum_algorithm?: string, checksum_value?: string } | undefined}
 */
function parse_checksum_params(req) {
    const algorithm_header =
        req.headers[S3_CHECKSUM_ALGORITHM_HEADER] ||
        req.headers[S3_SDK_CHECKSUM_ALGORITHM_HEADER];
    const algorithm = algorithm_header ? algorithm_header.toUpperCase() : undefined;

    const checksum_value = req.headers[S3_CHECKSUM_SHA512_HEADER];
    const detected_algorithm = algorithm || (checksum_value ? 'SHA512' : undefined);

    if (!detected_algorithm && !checksum_value) return undefined;

    // Silently skip algorithms we don't support (e.g. CRC32 sent by AWS SDK defaults).
    // Before additional checksum support these headers were ignored — keep that behavior.
    if (!Object.hasOwn(S3_CHECKSUM_ALGORITHM, detected_algorithm)) return undefined;

    return {
        checksum_algorithm: detected_algorithm,
        checksum_value,
    };
}

/**
 * Extracts checksum from chunked upload trailers (aws-chunked encoding).
 * AWS SDK sends trailing checksums after the body — this reads them from
 * the parsed trailer array returned by ChunkedContentDecoder.get_trailers().
 * @param {string[]} trailers - array of "key:value" strings from ChunkedContentDecoder
 * @returns {{ checksum_algorithm?: string, checksum_value?: string } | undefined}
 */
function parse_checksum_params_from_trailers(trailers) {
    if (!trailers || !trailers.length) return undefined;
    for (const trailer of trailers) {
        const colon_idx = trailer.indexOf(':');
        if (colon_idx < 0) continue;
        const key = trailer.substring(0, colon_idx).trim().toLowerCase();
        if (key === S3_CHECKSUM_SHA512_HEADER) {
            const value = trailer.substring(colon_idx + 1).trim();
            if (value) {
                return { checksum_algorithm: 'SHA512', checksum_value: value };
            }
        }
    }
}

/**
 * @param {string} algorithm - S3 algorithm name (e.g. 'SHA512')
 * @returns {crypto.Hash | undefined}
 */
function create_checksum_hasher(algorithm) {
    if (!Object.hasOwn(S3_CHECKSUM_ALGORITHM, algorithm)) return undefined;
    // SHA-512 is available from OpenSSL in FIPS mode. MD5 and SHA-1 are the
    // hashes that need the ISA-L path in fips.js.
    return crypto.createHash(S3_CHECKSUM_ALGORITHM[algorithm]);
}

/**
 * CreateMultipartUpload must keep the algorithm only.
 * A value on that request has not been compared to any bytes.
 * @param {object} [checksum_params]
 * @returns {{ checksum_algorithm: string } | undefined}
 */
function algorithm_only_params(checksum_params) {
    if (!checksum_params || !checksum_params.checksum_algorithm) return undefined;
    return { checksum_algorithm: checksum_params.checksum_algorithm };
}

/**
 * SHA-512 digests are 64 bytes. Node's base64 decoder does not reject bad input.
 * @param {string} value
 * @returns {boolean}
 */
function is_sha512_checksum_b64(value) {
    if (typeof value !== 'string' || !(/^[A-Za-z0-9+/]+=*$/).test(value)) return false;
    return Buffer.from(value, 'base64').length === SHA512_DIGEST_BYTES;
}

/**
 * Compare a computed SHA-512 digest with the client header or trailer.
 * A value that is not 64 bytes is INVALID_DIGEST. A different digest is BAD_DIGEST_CHECKSUM.
 * @param {string} computed_b64
 * @param {{ checksum_value?: string, _chunked_decoder?: { get_trailers: () => string[] } }} [checksum_params]
 * @returns {{ checksum_algorithm: string, checksum_value: string, checksum_type: string }}
 */
function sha512_checksum_params(computed_b64, checksum_params) {
    let expected_b64 = checksum_params && checksum_params.checksum_value;
    if (!expected_b64 && checksum_params && checksum_params._chunked_decoder) {
        const trailer_params = parse_checksum_params_from_trailers(
            checksum_params._chunked_decoder.get_trailers()
        );
        expected_b64 = trailer_params && trailer_params.checksum_value;
    }
    if (expected_b64 && !is_sha512_checksum_b64(expected_b64)) {
        throw new RpcError('INVALID_DIGEST', 'The checksum you specified is not valid.');
    }
    if (expected_b64 && computed_b64 !== expected_b64) {
        throw new RpcError('BAD_DIGEST_CHECKSUM',
            'The checksum you specified did not match what we received.');
    }
    return {
        checksum_algorithm: 'SHA512',
        checksum_value: expected_b64 || computed_b64,
        checksum_type: CHECKSUM_TYPE.FULL_OBJECT,
    };
}

/**
 * A multipart upload that declared a checksum needs a digest on every selected part.
 * @param {object} target
 * @param {string} [upload_algorithm]
 * @param {object} [composite]
 */
function assign_multipart_composite(target, upload_algorithm, composite) {
    if (upload_algorithm && !composite) {
        throw new RpcError('INVALID_REQUEST',
            'The multipart upload includes a checksum algorithm, but not every part has a checksum.');
    }
    assign_checksum_fields(target, composite);
}

/**
 * Copies supported checksum fields onto a metadata object.
 * Ignores internal fields such as _chunked_decoder.
 * @param {object} target
 * @param {object} [checksum_params]
 */
function assign_checksum_fields(target, checksum_params) {
    if (!checksum_params) return;
    if (checksum_params.checksum_algorithm) target.checksum_algorithm = checksum_params.checksum_algorithm;
    if (checksum_params.checksum_value) target.checksum_value = checksum_params.checksum_value;
    if (checksum_params.checksum_type) target.checksum_type = checksum_params.checksum_type;
}

/**
 * Stores a checked part digest. The object checksum type is set later, at complete.
 * @param {object} target
 * @param {object} [checksum_params]
 */
function assign_part_checksum(target, checksum_params) {
    if (!checksum_params || !checksum_params.checksum_value) return;
    target.checksum_algorithm = checksum_params.checksum_algorithm;
    target.checksum_value = checksum_params.checksum_value;
}

/**
 * @param {object} [primary]
 * @param {object} [fallback]
 * @returns {{ checksum_algorithm: string|undefined, checksum_value: string|undefined, checksum_type: string|undefined }}
 */
function checksum_reply_fields(primary, fallback) {
    const first = primary || {};
    const second = fallback || {};
    return {
        checksum_algorithm: first.checksum_algorithm || second.checksum_algorithm || undefined,
        checksum_value: first.checksum_value || second.checksum_value || undefined,
        checksum_type: first.checksum_type || second.checksum_type || undefined,
    };
}

/**
 * Builds a composite checksum from per-part checksums (AWS multipart format).
 * Concatenates the raw digest bytes of all parts, hashes them again,
 * and returns "base64hash-N" where N is the number of parts.
 * @param {string} algorithm - S3 algorithm name (e.g. 'SHA512')
 * @param {string[]} part_checksums_b64 - array of base64-encoded per-part checksums
 * @returns {string} composite checksum in "base64-N" format
 */
function build_composite_checksum(algorithm, part_checksums_b64) {
    if (!part_checksums_b64 || !part_checksums_b64.length) {
        throw new Error('build_composite_checksum: no part checksums provided');
    }
    const hasher = create_checksum_hasher(algorithm);
    if (!hasher) throw new Error(`Unsupported checksum algorithm: ${algorithm}`);
    for (const part_b64 of part_checksums_b64) {
        if (!is_sha512_checksum_b64(part_b64)) {
            throw new RpcError('INVALID_DIGEST', 'The checksum you specified is not valid.');
        }
        hasher.update(Buffer.from(part_b64, 'base64'));
    }
    return hasher.digest('base64') + '-' + part_checksums_b64.length;
}

/**
 * Composite checksum for a completed multipart object.
 * Returns undefined unless every part has the same algorithm and a value.
 * @param {object[]} parts
 * @returns {{ checksum_algorithm: string, checksum_value: string, checksum_type: string } | undefined}
 */
function composite_checksum_from_parts(parts) {
    if (!parts || !parts.length) return undefined;
    const algorithm = parts[0].checksum_algorithm;
    if (!algorithm) return undefined;
    const part_checksums = [];
    for (const part of parts) {
        if (part.checksum_algorithm !== algorithm || !part.checksum_value) return undefined;
        part_checksums.push(part.checksum_value);
    }
    return {
        checksum_algorithm: algorithm,
        checksum_value: build_composite_checksum(algorithm, part_checksums),
        checksum_type: CHECKSUM_TYPE.COMPOSITE,
    };
}

/**
 * @param {string} algorithm
 * @returns {string | undefined} e.g. 'x-amz-checksum-sha512'
 */
function get_checksum_response_header(algorithm) {
    if (algorithm === 'SHA512') return S3_CHECKSUM_SHA512_HEADER;
    return undefined;
}

/**
 * @param {object} res - HTTP response
 * @param {object} object_md - object metadata with checksum fields
 */
function set_response_checksum_headers(res, object_md) {
    if (!object_md.checksum_algorithm || !object_md.checksum_value) return;
    const header = get_checksum_response_header(object_md.checksum_algorithm);
    if (header) {
        res.setHeader(header, object_md.checksum_value);
    }
    if (object_md.checksum_type) {
        res.setHeader(S3_CHECKSUM_TYPE_HEADER, object_md.checksum_type);
    }
}

exports.S3_CHECKSUM_ALGORITHM = S3_CHECKSUM_ALGORITHM;
exports.S3_CHECKSUM_ALGORITHM_HEADER = S3_CHECKSUM_ALGORITHM_HEADER;
exports.S3_CHECKSUM_SHA512_HEADER = S3_CHECKSUM_SHA512_HEADER;
exports.S3_CHECKSUM_TYPE_HEADER = S3_CHECKSUM_TYPE_HEADER;
exports.CHECKSUM_TYPE = CHECKSUM_TYPE;
exports.validate_checksum_algorithm = validate_checksum_algorithm;
exports.parse_checksum_params = parse_checksum_params;
exports.algorithm_only_params = algorithm_only_params;
exports.is_sha512_checksum_b64 = is_sha512_checksum_b64;
exports.assign_multipart_composite = assign_multipart_composite;
exports.parse_checksum_params_from_trailers = parse_checksum_params_from_trailers;
exports.create_checksum_hasher = create_checksum_hasher;
exports.sha512_checksum_params = sha512_checksum_params;
exports.assign_checksum_fields = assign_checksum_fields;
exports.assign_part_checksum = assign_part_checksum;
exports.checksum_reply_fields = checksum_reply_fields;
exports.build_composite_checksum = build_composite_checksum;
exports.composite_checksum_from_parts = composite_checksum_from_parts;
exports.get_checksum_response_header = get_checksum_response_header;
exports.set_response_checksum_headers = set_response_checksum_headers;
