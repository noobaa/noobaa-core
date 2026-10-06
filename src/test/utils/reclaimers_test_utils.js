/* Copyright (C) 2026 NooBaa */
'use strict';

const assert = require('assert');

const config = require('../../../config');
const buffer_utils = require('../../util/buffer_utils');
const ObjectIO = require('../../sdk/object_io');
const { MDStore } = require('../../server/object_services/md_store');
const test_utils = require('../system_tests/test_utils');
const coretest = require('./coretest/coretest');
const { rpc_client, EMAIL } = coretest;

const object_io = new ObjectIO();
object_io.set_verification_mode();

const OBJ_SIZE = 128;

/**
 * Create an archive namespace and a bucket that uses it as deep_archive_resource.
 * DEEP_ARCHIVE reclaim treats objects as remote only when the bucket has that policy.
 * @param {{ bucket: string, archive_target_bucket: string, archive_connection: string, archive_nsr: string }} names
 */
async function create_archive_bucket({ bucket, archive_target_bucket, archive_connection, archive_nsr }) {
    config.ARCHIVE_TARGET_BUCKET_CHECK_ENABLED = false;
    const account_info = await rpc_client.account.read_account({ email: EMAIL });
    await rpc_client.bucket.create_bucket({ name: archive_target_bucket });
    await rpc_client.account.add_external_connection({
        name: archive_connection,
        endpoint: coretest.get_http_address(),
        endpoint_type: 'S3_COMPATIBLE',
        auth_method: 'AWS_V4',
        identity: account_info.access_keys[0].access_key.unwrap(),
        secret: account_info.access_keys[0].secret_key.unwrap(),
    });
    await rpc_client.pool.create_namespace_resource({
        name: archive_nsr,
        connection: archive_connection,
        target_bucket: archive_target_bucket,
        archive: true,
    });
    await rpc_client.bucket.create_bucket({
        name: bucket,
        archive_policy: {
            deep_archive_resource: { resource: archive_nsr },
        },
    });
}

/**
 * @param {{ bucket: string, archive_target_bucket: string, archive_connection: string, archive_nsr: string }} names
 */
async function delete_archive_bucket({ bucket, archive_target_bucket, archive_connection, archive_nsr }) {
    try {
        await test_utils.empty_and_delete_buckets(rpc_client, [bucket]);
        await rpc_client.pool.delete_namespace_resource({ name: archive_nsr });
        await rpc_client.account.delete_external_connection({ connection_name: archive_connection });
        await test_utils.empty_and_delete_buckets(rpc_client, [archive_target_bucket]);
    } catch (_err) {
        // ignore cleanup failures
    } finally {
        config.ARCHIVE_TARGET_BUCKET_CHECK_ENABLED = true;
    }
}

/**
 * Upload a real object (writes local STANDARD parts/chunks), then patch MD for the
 * reclaim scenario under test.
 *
 * Patching storage_class to DEEP_ARCHIVE/GLACIER does not move data to archive — it
 * only updates object MD so the object looks archived while local mappings still
 * exist (as after restore, or as leftover source data after lifecycle transition).
 * Reclaim tests then verify those local mappings are purged.
 * @param {string} bucket
 * @param {object} md_updates
 */
async function upload_and_patch(bucket, md_updates) {
    const key = `expire-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const data = Buffer.alloc(OBJ_SIZE, 0x61);
    const params = {
        client: rpc_client,
        bucket,
        key,
        size: OBJ_SIZE,
        content_type: 'application/octet-stream',
        source_stream: buffer_utils.buffer_to_read_stream(data),
    };
    await object_io.upload_object(params);
    const obj_id = MDStore.instance().make_md_id(params.obj_id);
    await MDStore.instance().update_object_by_id(obj_id, md_updates);
    const obj = await MDStore.instance().find_object_by_id(obj_id);
    const parts = await MDStore.instance().find_all_parts_of_object(obj);
    assert.ok(parts.length > 0, 'uploaded object should have local parts');
    return obj;
}

/**
 * Object MD must remain live — reclaim only drops local copy mappings.
 * @param {object} obj_id
 */
async function assert_object_not_deleted(obj_id) {
    const obj = await MDStore.instance().find_object_by_id(obj_id);
    assert.ok(obj, 'object MD must still exist');
    assert.ok(!obj.deleted, 'object must not be soft-deleted; only local copies are reclaimed');
    return obj;
}

exports.create_archive_bucket = create_archive_bucket;
exports.delete_archive_bucket = delete_archive_bucket;
exports.upload_and_patch = upload_and_patch;
exports.assert_object_not_deleted = assert_object_not_deleted;
