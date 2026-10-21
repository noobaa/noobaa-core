/* Copyright (C) 2016 NooBaa */
'use strict';

const { create_hash_fips } = require('./fips');

// Currently only SHA-512 is supported.
// To add a new algorithm: add it to S3_CHECKSUM_ALGORITHM and update
// parse/header functions below.
const S3_CHECKSUM_ALGORITHM = Object.freeze({
    SHA512: 'sha512',
});

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
    if (!S3_CHECKSUM_ALGORITHM[algorithm]) {
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

    return {
        checksum_algorithm: detected_algorithm,
        checksum_value,
    };
}

/**
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
    return undefined;
}

/**
 * @param {string} algorithm - S3 algorithm name (e.g. 'SHA512')
 * @returns {crypto.Hash | undefined}
 */
function create_checksum_hasher(algorithm) {
    const hash_name = S3_CHECKSUM_ALGORITHM[algorithm];
    if (!hash_name) return undefined;
    return create_hash_fips(hash_name);
}

/**
 * @param {string} algorithm
 * @param {Buffer} data
 * @returns {string} base64-encoded checksum
 */
function compute_checksum_b64(algorithm, data) {
    const hasher = create_checksum_hasher(algorithm);
    if (!hasher) throw new Error(`Unsupported checksum algorithm: ${algorithm}`);
    return hasher.update(data).digest('base64');
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
exports.parse_checksum_params_from_trailers = parse_checksum_params_from_trailers;
exports.create_checksum_hasher = create_checksum_hasher;
exports.compute_checksum_b64 = compute_checksum_b64;
exports.get_checksum_response_header = get_checksum_response_header;
exports.set_response_checksum_headers = set_response_checksum_headers;
