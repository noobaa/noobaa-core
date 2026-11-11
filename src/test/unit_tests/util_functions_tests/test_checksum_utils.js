/* Copyright (C) 2016 NooBaa */
'use strict';

const crypto = require('crypto');
const mocha = require('mocha');
const assert = require('assert');
const checksum_utils = require('../../../util/checksum_utils');

mocha.describe('checksum_utils', function() {

    mocha.describe('parse_checksum_params', function() {

        mocha.it('should return undefined when no checksum headers are present', function() {
            const req = { headers: {} };
            assert.strictEqual(checksum_utils.parse_checksum_params(req), undefined);
        });

        mocha.it('should parse x-amz-checksum-algorithm header', function() {
            const req = { headers: { 'x-amz-checksum-algorithm': 'SHA512' } };
            const result = checksum_utils.parse_checksum_params(req);
            assert.strictEqual(result.checksum_algorithm, 'SHA512');
            assert.strictEqual(result.checksum_value, undefined);
        });

        mocha.it('should parse x-amz-checksum-sha512 header with value', function() {
            const value = crypto.createHash('sha512').update('test').digest('base64');
            const req = { headers: { 'x-amz-checksum-sha512': value } };
            const result = checksum_utils.parse_checksum_params(req);
            assert.strictEqual(result.checksum_algorithm, 'SHA512');
            assert.strictEqual(result.checksum_value, value);
        });

        mocha.it('should return undefined for unsupported algorithm header', function() {
            const value = crypto.createHash('sha256').update('hello').digest('base64');
            const req = { headers: { 'x-amz-checksum-sha256': value } };
            const result = checksum_utils.parse_checksum_params(req);
            assert.strictEqual(result, undefined);
        });

        // All S3 checksum algorithm names AWS recognises.
        // Any entry absent from S3_CHECKSUM_ALGORITHM is currently unsupported by NooBaa.
        const ALL_S3_ALGORITHMS = ['CRC32', 'CRC32C', 'SHA1', 'SHA256', 'SHA512', 'MD5'];

        mocha.it('should return undefined for every unsupported checksum algorithm', function() {
            const supported = new Set(Object.keys(checksum_utils.S3_CHECKSUM_ALGORITHM));
            const unsupported = ALL_S3_ALGORITHMS.filter(algo => !supported.has(algo));

            assert.ok(unsupported.length > 0, 'expected at least one unsupported algorithm');

            for (const algo of unsupported) {
                const req = { headers: { 'x-amz-checksum-algorithm': algo } };
                assert.strictEqual(
                    checksum_utils.parse_checksum_params(req),
                    undefined,
                    `expected undefined for unsupported algorithm ${algo}`
                );
            }
        });

        mocha.it('should parse the SDK SHA512 header when the digest is present', function() {
            const value = crypto.createHash('sha512').update('sdk').digest('base64');
            const req = {
                headers: {
                    'x-amz-sdk-checksum-algorithm': 'sha512',
                    'x-amz-checksum-sha512': value,
                },
            };
            const result = checksum_utils.parse_checksum_params(req);
            assert.strictEqual(result.checksum_algorithm, 'SHA512');
            assert.strictEqual(result.checksum_value, value);
        });

        mocha.it('should reject the SDK SHA512 header when no digest or trailer is present', function() {
            const req = { headers: { 'x-amz-sdk-checksum-algorithm': 'sha512' } };
            assert.throws(
                () => checksum_utils.parse_checksum_params(req),
                err => err.rpc_code === 'INVALID_REQUEST'
            );
        });

        mocha.it('should keep ignoring an unsupported SDK algorithm', function() {
            const req = { headers: { 'x-amz-sdk-checksum-algorithm': 'CRC32' } };
            assert.strictEqual(checksum_utils.parse_checksum_params(req), undefined);
        });

        mocha.it('should detect SHA512 from the trailer header alone', function() {
            const req = { headers: { 'x-amz-trailer': 'x-amz-checksum-sha512' } };
            const result = checksum_utils.parse_checksum_params(req);
            assert.strictEqual(result.checksum_algorithm, 'SHA512');
            assert.strictEqual(result.checksum_value, undefined);
        });

        mocha.it('should reject a SHA512 digest sent with a different algorithm', function() {
            const value = crypto.createHash('sha512').update('mixed').digest('base64');
            const req = {
                headers: {
                    'x-amz-checksum-algorithm': 'CRC32',
                    'x-amz-checksum-sha512': value,
                },
            };
            assert.throws(
                () => checksum_utils.parse_checksum_params(req),
                err => err.rpc_code === 'INVALID_REQUEST'
            );
        });
    });

    mocha.describe('parse_checksum_params_from_trailers', function() {

        mocha.it('should return undefined for empty trailers', function() {
            assert.strictEqual(checksum_utils.parse_checksum_params_from_trailers(undefined), undefined);
            assert.strictEqual(checksum_utils.parse_checksum_params_from_trailers([]), undefined);
        });

        mocha.it('should parse sha512 checksum from trailer string', function() {
            const value = crypto.createHash('sha512').update('data').digest('base64');
            const trailers = [`x-amz-checksum-sha512:${value}`];
            const result = checksum_utils.parse_checksum_params_from_trailers(trailers);
            assert.strictEqual(result.checksum_algorithm, 'SHA512');
            assert.strictEqual(result.checksum_value, value);
        });

        mocha.it('should ignore non-checksum trailers', function() {
            const trailers = ['x-amz-content-sha256:STREAMING-AWS4-HMAC-SHA256-PAYLOAD'];
            const result = checksum_utils.parse_checksum_params_from_trailers(trailers);
            assert.strictEqual(result, undefined);
        });

        mocha.it('should ignore unsupported checksum trailers', function() {
            const value = crypto.createHash('sha256').update('data').digest('base64');
            const trailers = [`x-amz-checksum-sha256:${value}`];
            const result = checksum_utils.parse_checksum_params_from_trailers(trailers);
            assert.strictEqual(result, undefined);
        });
    });

    mocha.describe('validate_checksum_algorithm', function() {

        mocha.it('should not throw for SHA512', function() {
            assert.doesNotThrow(() => checksum_utils.validate_checksum_algorithm('SHA512'));
        });

        mocha.it('should not throw for undefined', function() {
            assert.doesNotThrow(() => checksum_utils.validate_checksum_algorithm(undefined));
        });

        mocha.it('should throw for SHA256', function() {
            assert.throws(
                () => checksum_utils.validate_checksum_algorithm('SHA256'),
                /Unsupported checksum algorithm.*SHA256/
            );
        });

        mocha.it('should throw for CRC32', function() {
            assert.throws(
                () => checksum_utils.validate_checksum_algorithm('CRC32'),
                /Unsupported checksum algorithm.*CRC32/
            );
        });
    });

    mocha.describe('create_checksum_hasher', function() {

        mocha.it('should create SHA512 hasher', function() {
            const hasher = checksum_utils.create_checksum_hasher('SHA512');
            assert(hasher);
            hasher.update('test');
            const digest = hasher.digest('base64');
            const expected = crypto.createHash('sha512').update('test').digest('base64');
            assert.strictEqual(digest, expected);
        });

        mocha.it('should return undefined for unsupported algorithm', function() {
            assert.strictEqual(checksum_utils.create_checksum_hasher('SHA256'), undefined);
            assert.strictEqual(checksum_utils.create_checksum_hasher('CRC32'), undefined);
            assert.strictEqual(checksum_utils.create_checksum_hasher('toString'), undefined);
        });
    });

    mocha.describe('composite checksum', function() {

        function sha512_b64(data) {
            return crypto.createHash('sha512').update(data).digest('base64');
        }

        mocha.it('should build a composite checksum from part digests', function() {
            const part1 = sha512_b64(Buffer.from('a'));
            const part2 = sha512_b64(Buffer.from('b'));
            const composite = checksum_utils.build_composite_checksum('SHA512', [part1, part2]);
            const hasher = crypto.createHash('sha512');
            hasher.update(Buffer.from(part1, 'base64'));
            hasher.update(Buffer.from(part2, 'base64'));
            assert.strictEqual(composite, hasher.digest('base64') + '-2');
        });

        mocha.it('should skip composite when a part has no checksum', function() {
            const part = { checksum_algorithm: 'SHA512', checksum_value: 'abc' };
            assert.strictEqual(checksum_utils.composite_checksum_from_parts([part, {}]), undefined);
        });

        mocha.it('should reject a part digest that is not a SHA512 checksum', function() {
            assert.throws(
                () => checksum_utils.build_composite_checksum('SHA512', ['abc']),
                err => err.rpc_code === 'INVALID_DIGEST'
            );
        });
    });

    mocha.describe('checksum value checks', function() {

        mocha.it('should accept a 64 byte SHA512 digest', function() {
            const value = crypto.createHash('sha512').update('ok').digest('base64');
            assert.strictEqual(checksum_utils.is_sha512_checksum_b64(value), true);
        });

        mocha.it('should reject a short checksum', function() {
            assert.strictEqual(checksum_utils.is_sha512_checksum_b64('abc'), false);
        });

        mocha.it('should return the client digest when it matches', function() {
            const value = crypto.createHash('sha512').update('body').digest('base64');
            assert.deepStrictEqual(checksum_utils.sha512_checksum_params(value, {
                checksum_value: value,
            }), {
                checksum_algorithm: 'SHA512',
                checksum_value: value,
                checksum_type: 'FULL_OBJECT',
            });
        });

        mocha.it('should read the expected digest from trailers', function() {
            const value = crypto.createHash('sha512').update('body').digest('base64');
            const result = checksum_utils.sha512_checksum_params(value, {
                _chunked_decoder: {
                    get_trailers: () => [`x-amz-checksum-sha512:${value}`],
                },
            });
            assert.strictEqual(result.checksum_value, value);
        });

        mocha.it('should reject a digest that does not match', function() {
            const computed = crypto.createHash('sha512').update('body').digest('base64');
            const other = crypto.createHash('sha512').update('other').digest('base64');
            assert.throws(
                () => checksum_utils.sha512_checksum_params(computed, { checksum_value: other }),
                err => err.rpc_code === 'BAD_DIGEST_CHECKSUM'
            );
        });

        mocha.it('should reject a checksum that is not 64 bytes', function() {
            const computed = crypto.createHash('sha512').update('body').digest('base64');
            assert.throws(
                () => checksum_utils.sha512_checksum_params(computed, { checksum_value: 'abc' }),
                err => err.rpc_code === 'INVALID_DIGEST'
            );
        });

        mocha.it('should keep only the algorithm from initiate params', function() {
            const params = checksum_utils.algorithm_only_params({
                checksum_algorithm: 'SHA512',
                checksum_value: 'unchecked',
                checksum_type: 'FULL_OBJECT',
            });
            assert.deepStrictEqual(params, { checksum_algorithm: 'SHA512' });
        });

        mocha.it('should fail completion when the upload algorithm has no composite', function() {
            const target = {};
            assert.throws(
                () => checksum_utils.assign_multipart_composite(target, 'SHA512', undefined),
                err => err.rpc_code === 'INVALID_REQUEST'
            );
            assert.deepStrictEqual(target, {});
        });
    });

    mocha.describe('get_checksum_response_header', function() {

        mocha.it('should return correct header for SHA512', function() {
            assert.strictEqual(
                checksum_utils.get_checksum_response_header('SHA512'),
                'x-amz-checksum-sha512'
            );
        });

        mocha.it('should return undefined for unsupported algorithm', function() {
            assert.strictEqual(checksum_utils.get_checksum_response_header('SHA256'), undefined);
            assert.strictEqual(checksum_utils.get_checksum_response_header('CRC32'), undefined);
        });
    });

    mocha.describe('set_response_checksum_headers', function() {

        mocha.it('should set checksum header on response', function() {
            const headers = {};
            const res = {
                setHeader(name, value) { headers[name] = value; },
            };
            const object_md = {
                checksum_algorithm: 'SHA512',
                checksum_value: 'abc123==',
                checksum_type: 'FULL_OBJECT',
            };
            checksum_utils.set_response_checksum_headers(res, object_md);
            assert.strictEqual(headers['x-amz-checksum-sha512'], 'abc123==');
            assert.strictEqual(headers['x-amz-checksum-type'], 'FULL_OBJECT');
        });

        mocha.it('should not set headers when no checksum', function() {
            const headers = {};
            const res = {
                setHeader(name, value) { headers[name] = value; },
            };
            checksum_utils.set_response_checksum_headers(res, {});
            assert.strictEqual(Object.keys(headers).length, 0);
        });

        mocha.it('should set COMPOSITE type header', function() {
            const headers = {};
            const res = {
                setHeader(name, value) { headers[name] = value; },
            };
            const object_md = {
                checksum_algorithm: 'SHA512',
                checksum_value: 'composite-value==-3',
                checksum_type: 'COMPOSITE',
            };
            checksum_utils.set_response_checksum_headers(res, object_md);
            assert.strictEqual(headers['x-amz-checksum-sha512'], 'composite-value==-3');
            assert.strictEqual(headers['x-amz-checksum-type'], 'COMPOSITE');
        });
    });

    mocha.describe('sha512_checksum_params', function() {

        mocha.it('returns the client value when it matches the computed digest', function() {
            const value = crypto.createHash('sha512').update('body').digest('base64');
            assert.deepStrictEqual(checksum_utils.sha512_checksum_params(value, {
                checksum_value: value,
            }), {
                checksum_algorithm: 'SHA512',
                checksum_value: value,
                checksum_type: 'FULL_OBJECT',
            });
        });

        mocha.it('reads the expected value from trailers', function() {
            const value = crypto.createHash('sha512').update('body').digest('base64');
            const result = checksum_utils.sha512_checksum_params(value, {
                _chunked_decoder: {
                    get_trailers: () => [`x-amz-checksum-sha512:${value}`],
                },
            });
            assert.strictEqual(result.checksum_value, value);
        });

        mocha.it('throws BAD_DIGEST_CHECKSUM when the client value does not match', function() {
            assert.throws(
                () => checksum_utils.sha512_checksum_params('Y29tcHV0ZWQ=', { checksum_value: 'Y2xpZW50' }),
                err => err.rpc_code === 'BAD_DIGEST_CHECKSUM'
            );
        });
    });

    mocha.describe('constants', function() {

        mocha.it('S3_CHECKSUM_ALGORITHM should only have SHA512', function() {
            assert.strictEqual(checksum_utils.S3_CHECKSUM_ALGORITHM.SHA512, 'sha512');
            assert.strictEqual(checksum_utils.S3_CHECKSUM_ALGORITHM.SHA256, undefined);
        });

        mocha.it('CHECKSUM_TYPE should have FULL_OBJECT and COMPOSITE', function() {
            assert.strictEqual(checksum_utils.CHECKSUM_TYPE.FULL_OBJECT, 'FULL_OBJECT');
            assert.strictEqual(checksum_utils.CHECKSUM_TYPE.COMPOSITE, 'COMPOSITE');
        });
    });
});
