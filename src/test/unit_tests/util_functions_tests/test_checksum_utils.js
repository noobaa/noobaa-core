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

        mocha.it('should handle x-amz-sdk-checksum-algorithm header', function() {
            const req = { headers: { 'x-amz-sdk-checksum-algorithm': 'sha512' } };
            const result = checksum_utils.parse_checksum_params(req);
            assert.strictEqual(result.checksum_algorithm, 'SHA512');
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
        });
    });

    mocha.describe('compute_checksum_b64', function() {

        mocha.it('should compute SHA512 checksum in base64', function() {
            const data = Buffer.from('hello world');
            const result = checksum_utils.compute_checksum_b64('SHA512', data);
            const expected = crypto.createHash('sha512').update(data).digest('base64');
            assert.strictEqual(result, expected);
        });

        mocha.it('should throw for unsupported algorithm', function() {
            assert.throws(
                () => checksum_utils.compute_checksum_b64('SHA256', Buffer.from('x')),
                /Unsupported checksum algorithm/
            );
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
