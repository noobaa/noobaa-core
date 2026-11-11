/* Copyright (C) 2026 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');
const NamespaceMultiStorageClass = require('../../../sdk/namespace_multi_storage_class');
const s3_utils = require('../../../endpoint/s3/s3_utils');

/**
 * @param {object} metadata_ns
 * @param {object} archive_ns
 * @returns {NamespaceMultiStorageClass}
 */
function make_msc(metadata_ns, archive_ns) {
    return new NamespaceMultiStorageClass({
        namespace_by_storage_class: {
            [s3_utils.STORAGE_CLASS_STANDARD]: metadata_ns,
            [s3_utils.STORAGE_CLASS_GLACIER]: archive_ns,
            [s3_utils.STORAGE_CLASS_DEEP_ARCHIVE]: archive_ns,
        },
    });
}

mocha.describe('archive PutObject checksum', function() {

    mocha.it('stores only the digest returned by the target upload', async function() {
        const client_checksum = {
            checksum_algorithm: 'SHA512',
            checksum_value: 'client-value==',
            checksum_type: 'FULL_OBJECT',
            _chunked_decoder: {},
        };
        let create_params;
        let complete_params;
        let uploaded_params;
        const metadata_ns = {
            async create_object_upload(params) {
                create_params = params;
                return { obj_id: 'obj-1', bucket_id: 'bucket-1' };
            },
            async complete_object_upload(params) {
                complete_params = params;
                return { etag: 'etag', checksum_params: params.checksum_params };
            },
        };
        const archive_ns = {
            async upload_object(params) {
                uploaded_params = params;
                return {
                    etag: 'etag',
                    last_modified_time: new Date('2026-01-01T00:00:00Z'),
                    checksum_params: {
                        checksum_algorithm: 'SHA512',
                        checksum_value: 'checked-value==',
                        checksum_type: 'FULL_OBJECT',
                        _chunked_decoder: client_checksum._chunked_decoder,
                    },
                };
            },
        };
        const msc = make_msc(metadata_ns, archive_ns);
        const reply = await msc.upload_object({
            bucket: 'bucket',
            key: 'key',
            size: 4,
            storage_class: s3_utils.STORAGE_CLASS_GLACIER,
            checksum_params: client_checksum,
            source_stream: {},
        }, {});

        assert.strictEqual(create_params.checksum_params, undefined);
        assert.strictEqual(uploaded_params.checksum_params, client_checksum);
        assert.deepStrictEqual(complete_params.checksum_params, {
            checksum_algorithm: 'SHA512',
            checksum_value: 'checked-value==',
            checksum_type: 'FULL_OBJECT',
        });
        assert.deepStrictEqual(reply.checksum_params, complete_params.checksum_params);
    });

    mocha.it('does not store a checksum when the target upload does not return one', async function() {
        let create_params;
        let complete_params;
        const metadata_ns = {
            async create_object_upload(params) {
                create_params = params;
                return { obj_id: 'obj-1', bucket_id: 'bucket-1' };
            },
            async complete_object_upload(params) {
                complete_params = params;
                return { etag: 'etag' };
            },
        };
        const archive_ns = {
            async upload_object() {
                return { etag: 'etag', last_modified_time: new Date('2026-01-01T00:00:00Z') };
            },
        };
        const msc = make_msc(metadata_ns, archive_ns);
        await msc.upload_object({
            bucket: 'bucket',
            key: 'key',
            size: 4,
            storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
            checksum_params: {
                checksum_algorithm: 'SHA512',
                checksum_value: 'client-value==',
            },
            source_stream: {},
        }, {});

        assert.strictEqual(create_params.checksum_params, undefined);
        assert.strictEqual(complete_params.checksum_params, undefined);
    });
});
