/* Copyright (C) 2026 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');
const ObjectSDK = require('../../../sdk/object_sdk');
const ObjectIO = require('../../../sdk/object_io');

const source_checksum = {
    checksum_algorithm: 'SHA512',
    checksum_value: 'source-sha512',
    checksum_type: 'FULL_OBJECT',
};

function source_md() {
    return {
        obj_id: 'src-id',
        version_id: 'ver',
        size: 8,
        content_type: 'text/plain',
        md5_b64: 'md5',
        sha256_b64: 'sha256',
        ...source_checksum,
    };
}

/**
 * @param {object} md
 * @param {boolean} server_side
 */
function sdk_for(md, server_side) {
    const sdk = Object.create(ObjectSDK.prototype);
    const source_ns = {
        async read_object_md() {
            return md;
        },
        async read_object_stream() {
            return {};
        },
        get_bucket(bucket) {
            return bucket;
        },
    };
    sdk._get_bucket_namespace = async () => source_ns;
    const target_ns = {
        get_write_resource() {
            return this;
        },
        is_server_side_copy() {
            return server_side;
        },
        get_bucket(bucket) {
            return bucket;
        },
    };
    return { sdk, target_ns };
}

mocha.describe('copy checksum', function() {

    mocha.it('replaces a client checksum with the source object checksum', async function() {
        const { sdk, target_ns } = sdk_for(source_md(), true);
        const params = {
            bucket: 'bucket',
            key: 'dest',
            copy_source: { bucket: 'bucket', key: 'src' },
            checksum_params: {
                checksum_algorithm: 'SHA512',
                checksum_value: 'client-sha512',
            },
        };
        await sdk.fix_copy_source_params(params, target_ns);
        assert.deepStrictEqual(params.checksum_params, source_checksum);
        assert.strictEqual(params.md5_b64, 'md5');
        assert.strictEqual(params.sha256_b64, 'sha256');
    });

    mocha.it('drops the checksum on a ranged copy', async function() {
        const md = source_md();
        const { sdk, target_ns } = sdk_for(md, true);
        const params = {
            bucket: 'bucket',
            key: 'dest',
            copy_source: {
                bucket: 'bucket',
                key: 'src',
                ranges: [{ start: 0, end: 4 }],
            },
            checksum_params: source_checksum,
        };
        await sdk.fix_copy_source_params(params, target_ns);
        assert.strictEqual(params.checksum_params, undefined);
        assert.strictEqual(params.md5_b64, undefined);
        assert.strictEqual(params.sha256_b64, undefined);
    });

    mocha.it('stores the source checksum when the copy does not read the body', async function() {
        let create_params;
        let complete_params;
        const io = new ObjectIO();
        await io.upload_object({
            bucket: 'bucket',
            key: 'dest',
            copy_source: { bucket: 'bucket', key: 'src', obj_id: 'src-id' },
            checksum_params: {
                checksum_algorithm: 'SHA512',
                checksum_value: 'client-sha512',
            },
            client: {
                object: {
                    async create_object_upload(params) {
                        create_params = params;
                        return {
                            obj_id: 'new-id',
                            bucket_id: 'bucket-id',
                            chunk_split_config: {},
                            chunk_coder_config: {},
                        };
                    },
                    async copy_object_mapping() {
                        return {
                            num_parts: 1,
                            object_md: {
                                size: 8,
                                md5_b64: 'md5',
                                sha256_b64: 'sha256',
                                etag: 'etag',
                                ...source_checksum,
                            },
                        };
                    },
                    async complete_object_upload(params) {
                        complete_params = params;
                        return { etag: 'etag' };
                    },
                },
            },
        });
        assert.deepStrictEqual(complete_params.checksum_params, source_checksum);
        assert.strictEqual(complete_params.md5_b64, 'md5');
        assert.notStrictEqual(
            complete_params.checksum_params.checksum_value,
            create_params.checksum_params.checksum_value,
        );
    });

    mocha.it('does not put the object checksum on a copied part', async function() {
        const io = new ObjectIO();
        const complete_params = {};
        await io._upload_copy({
            bucket: 'bucket',
            key: 'dest',
            multipart_id: 'upload-1',
            copy_source: { bucket: 'bucket', obj_id: 'src-id' },
            client: {
                object: {
                    async copy_object_mapping() {
                        return {
                            num_parts: 1,
                            object_md: {
                                size: 8,
                                md5_b64: 'md5',
                                sha256_b64: 'sha256',
                                etag: 'etag',
                                ...source_checksum,
                            },
                        };
                    },
                },
            },
        }, complete_params);
        assert.strictEqual(complete_params.md5_b64, 'md5');
        assert.strictEqual(complete_params.checksum_params, undefined);
    });
});
