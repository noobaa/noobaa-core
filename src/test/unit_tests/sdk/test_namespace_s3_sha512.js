/* Copyright (C) 2026 NooBaa */
'use strict';

const crypto = require('crypto');
const mocha = require('mocha');
const assert = require('assert');
const NamespaceS3 = require('../../../sdk/namespace_s3');
const list_parts = require('../../../endpoint/s3/ops/s3_get_object_uploadId');
const buffer_utils = require('../../../util/buffer_utils');
const checksum_utils = require('../../../util/checksum_utils');

function sha512_b64(data) {
    return crypto.createHash('sha512').update(data).digest('base64');
}

async function read_stream(body) {
    const chunks = [];
    for await (const chunk of body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

function namespace_with(s3) {
    const ns = new NamespaceS3({
        namespace_resource_id: 'ns1',
        bucket: 'target',
        stats: undefined,
        s3_params: {
            endpoint: 'http://127.0.0.1:9',
            credentials: { accessKeyId: 'key', secretAccessKey: 'secret' },
            region: 'us-east-1',
        },
    });
    ns.s3 = s3;
    return ns;
}

mocha.describe('namespace_s3 SHA-512', function() {

    mocha.it('does not send a checksum on CopyObject', async function() {
        let request;
        const ns = namespace_with({
            async copyObject(req) {
                request = req;
                return {
                    CopyObjectResult: {
                        ETag: '"etag"',
                        ChecksumSHA512: 'copied-digest',
                        ChecksumType: 'COMPOSITE',
                    },
                };
            },
        });
        const composite = checksum_utils.build_composite_checksum('SHA512', [sha512_b64('part')]);
        const res = await ns.upload_object({
            bucket: 'target',
            key: 'dest',
            copy_source: { bucket: 'source', key: 'src' },
            checksum_params: {
                checksum_algorithm: 'SHA512',
                checksum_value: composite,
                checksum_type: 'COMPOSITE',
            },
        }, {});
        assert.strictEqual(request.ChecksumAlgorithm, undefined);
        assert.strictEqual(request.ChecksumSHA512, undefined);
        assert.strictEqual(res.checksum_params.checksum_value, 'copied-digest');
        assert.strictEqual(res.checksum_params.checksum_type, 'COMPOSITE');
    });

    mocha.it('does not send a checksum on UploadPartCopy', async function() {
        let request;
        const ns = namespace_with({
            async uploadPartCopy(req) {
                request = req;
                return {
                    CopyPartResult: {
                        ETag: '"etag"',
                        ChecksumSHA512: 'part-digest',
                    },
                };
            },
        });
        const res = await ns.upload_multipart({
            bucket: 'target',
            key: 'dest',
            obj_id: 'upload-1',
            num: 1,
            copy_source: { bucket: 'source', key: 'src' },
            checksum_params: {
                checksum_algorithm: 'SHA512',
                checksum_value: sha512_b64('whole-object'),
                checksum_type: 'FULL_OBJECT',
            },
        }, {});
        assert.strictEqual(request.ChecksumAlgorithm, undefined);
        assert.strictEqual(request.ChecksumSHA512, undefined);
        assert.strictEqual(res.checksum_params.checksum_value, 'part-digest');
    });

    mocha.it('sends a full object SHA-512 on PutObject', async function() {
        const data = Buffer.from('put-body');
        const digest = sha512_b64(data);
        let request;
        const ns = namespace_with({
            async send(cmd) {
                request = cmd.input;
                await read_stream(cmd.input.Body);
                return { ETag: '"etag"', ChecksumSHA512: digest };
            },
        });
        const res = await ns.upload_object({
            bucket: 'target',
            key: 'obj',
            size: data.length,
            source_stream: buffer_utils.buffer_to_read_stream(data),
            checksum_params: {
                checksum_algorithm: 'SHA512',
                checksum_value: digest,
            },
        }, {});
        assert.strictEqual(request.ChecksumAlgorithm, 'SHA512');
        assert.strictEqual(request.ChecksumSHA512, digest);
        assert.strictEqual(res.checksum_params.checksum_value, digest);
        assert.strictEqual(res.checksum_params.checksum_type, 'FULL_OBJECT');
    });

    mocha.it('does not send a composite value on PutObject', async function() {
        const data = Buffer.from('put-body');
        let request;
        const ns = namespace_with({
            async send(cmd) {
                request = cmd.input;
                await read_stream(cmd.input.Body);
                return { ETag: '"etag"' };
            },
        });
        const composite = checksum_utils.build_composite_checksum('SHA512', [sha512_b64('part')]);
        const res = await ns.upload_object({
            bucket: 'target',
            key: 'obj',
            size: data.length,
            source_stream: buffer_utils.buffer_to_read_stream(data),
            checksum_params: {
                checksum_algorithm: 'SHA512',
                checksum_value: composite,
                checksum_type: 'COMPOSITE',
            },
        }, {});
        assert.strictEqual(request.ChecksumAlgorithm, undefined);
        assert.strictEqual(request.ChecksumSHA512, undefined);
        assert.strictEqual(res.checksum_params, undefined);
    });

    mocha.it('rejects a trailing SHA-512 that does not match and deletes the object', async function() {
        const data = Buffer.from('put-body');
        const deleted = [];
        const ns = namespace_with({
            async send(cmd) {
                await read_stream(cmd.input.Body);
                return { ETag: '"etag"', ChecksumSHA512: sha512_b64(data), VersionId: 'v1' };
            },
            async deleteObject(req) {
                deleted.push(req);
            },
        });
        await assert.rejects(
            ns.upload_object({
                bucket: 'target',
                key: 'obj',
                size: data.length,
                source_stream: buffer_utils.buffer_to_read_stream(data),
                checksum_params: {
                    checksum_algorithm: 'SHA512',
                    _chunked_decoder: {
                        get_trailers: () => ['x-amz-checksum-sha512:' + sha512_b64('wrong')],
                    },
                },
            }, {}),
            err => err.rpc_code === 'BAD_DIGEST_CHECKSUM',
        );
        assert.deepStrictEqual(deleted, [{
            Bucket: 'target',
            Key: 'obj',
            VersionId: 'v1',
        }]);
    });

    mocha.it('returns SHA-512 from ListParts when the target part has one', async function() {
        const ns = namespace_with({
            async listParts() {
                return {
                    IsTruncated: false,
                    Parts: [
                        { PartNumber: 1, Size: 4, ETag: '"aaa"', LastModified: new Date(0), ChecksumSHA512: 'digest-1' },
                        { PartNumber: 2, Size: 4, ETag: '"bbb"', LastModified: new Date(0) },
                    ],
                };
            },
        });
        const res = await ns.list_multiparts({
            bucket: 'target',
            key: 'obj',
            obj_id: 'upload-1',
        }, {});
        assert.strictEqual(res.multiparts[0].checksum_value, 'digest-1');
        assert.strictEqual(res.multiparts[1].checksum_value, undefined);
    });

    mocha.it('puts ChecksumSHA512 on the ListParts part that has a digest', async function() {
        const reply = await list_parts.handler({
            query: { uploadId: 'upload-1' },
            params: { bucket: 'bucket', key: 'key' },
            object_sdk: {
                async list_multiparts() {
                    return {
                        is_truncated: false,
                        multiparts: [
                            { num: 1, size: 4, etag: 'aaa', last_modified: new Date(0), checksum_value: 'digest-1' },
                            { num: 2, size: 4, etag: 'bbb', last_modified: new Date(0) },
                        ],
                    };
                },
            },
        });
        const parts = reply.ListPartsResult[1].map(item => item.Part);
        assert.strictEqual(parts[0].ChecksumSHA512, 'digest-1');
        assert.strictEqual(parts[1].ChecksumSHA512, undefined);
    });

    mocha.it('rejects a trailing SHA-512 that does not match on UploadPart', async function() {
        const data = Buffer.from('part-body');
        const ns = namespace_with({
            async uploadPart(req) {
                await read_stream(req.Body);
                return { ETag: '"etag"', ChecksumSHA512: sha512_b64(data) };
            },
        });
        await assert.rejects(
            ns.upload_multipart({
                bucket: 'target',
                key: 'obj',
                obj_id: 'upload-1',
                num: 2,
                size: data.length,
                source_stream: buffer_utils.buffer_to_read_stream(data),
                checksum_params: {
                    checksum_algorithm: 'SHA512',
                    _chunked_decoder: {
                        get_trailers: () => ['x-amz-checksum-sha512:' + sha512_b64('wrong')],
                    },
                },
            }, {}),
            err => err.rpc_code === 'BAD_DIGEST_CHECKSUM',
        );
    });
});
