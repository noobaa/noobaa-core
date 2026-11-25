/* Copyright (C) 2026 NooBaa */
'use strict';

const assert = require('assert');
const config = require('../../../../../config');
const P = require('../../../../util/promise');
const size_utils = require('../../../../util/size_utils');
const cloud_utils = require('../../../../util/cloud_utils');
const db_client = require('../../../../util/db_client');
const MDStore = require('../../../../server/object_services/md_store').MDStore;
const { quota_usage_cache } = require('../../../../server/object_services/quota_usage_cache');
const system_store = require('../../../../server/system_services/system_store').get_instance();
const md_aggregator = require('../../../../server/bg_services/md_aggregator');
const lifecycle = require('../../../../server/bg_services/lifecycle');
const { ObjectsReclaimer } = require('../../../../server/bg_services/objects_reclaimer');
const { ReplicationScanner } = require('../../../../server/bg_services/replication_scanner');
const { err_code } = require('../../../system_tests/test_utils');
const { rpc_client } = require('../../../utils/coretest/coretest');

// The bucket API accepts a size quota only in whole gigabytes (minimum 1).
// These tests store { value: 1, unit: 'G', mode: 'strict' } through update_bucket,
// which is the real enable path, and map that 1GiB to a small byte count here.
// Admission compares against that count. The triggers still add the real object
// sizes, so the counter itself is not scaled.
let scaled_byte_limit = null;
const original_size_unit_to_bigint = size_utils.size_unit_to_bigint;
size_utils.size_unit_to_bigint = function(size, unit) {
    if (scaled_byte_limit !== null && unit === 'G' && Number(size) === 1) {
        return BigInt(scaled_byte_limit);
    }
    return original_size_unit_to_bigint(size, unit);
};

const created_buckets = new Set();

function clear_size_scale() {
    scaled_byte_limit = null;
}

function bucket_of(name) {
    const bucket = system_store.data.systems[0].buckets_by_name[name];
    assert.ok(bucket, `bucket ${name} is not in the system store`);
    return bucket;
}

async function open_bucket(s3, name) {
    await remove_bucket(s3, name);
    await rpc_client.bucket.create_bucket({ name });
    created_buckets.add(name);
}

async function set_strict(name, { bytes, objects } = {}) {
    const quota = {
        mode: 'strict',
    };
    if (bytes) {
        scaled_byte_limit = bytes;
        quota.size = { value: 1, unit: 'G' };
    }
    if (objects) quota.quantity = { value: objects };
    await rpc_client.bucket.update_bucket({ name, quota });
}

async function set_async_count(name, objects) {
    clear_size_scale();
    await rpc_client.bucket.update_bucket({
        name,
        quota: { quantity: { value: objects } },
    });
}

// Mode only. The server keeps the size and quantity already stored on the bucket.
async function set_quota_mode(name, mode) {
    await rpc_client.bucket.update_bucket({
        name,
        quota: { mode },
    });
}

async function set_versioning(s3, name, status) {
    await s3.putBucketVersioning({
        Bucket: name,
        VersioningConfiguration: { Status: status },
    });
}

function make_body(size, fill) {
    return Buffer.alloc(size, fill % 256);
}

async function put_object(s3, bucket, key, size, fill) {
    const body = make_body(size, fill);
    await s3.putObject({ Bucket: bucket, Key: key, Body: body });
    return body;
}

async function read_object(s3, bucket, key, version_id) {
    const res = await s3.getObject({
        Bucket: bucket,
        Key: key,
        VersionId: version_id,
    });
    return Buffer.from(await res.Body.transformToByteArray());
}

async function expect_error(fn, code, status) {
    try {
        await fn();
    } catch (err) {
        assert.strictEqual(err_code(err), code, err.message);
        if (status) assert.strictEqual(err.$metadata.httpStatusCode, status);
        return;
    }
    assert.fail(`expected ${code}`);
}

async function usage(name) {
    const bucket = bucket_of(name);
    const row = await MDStore.instance().get_quota_usage(bucket._id);
    return {
        bytes: BigInt(row.used_bytes),
        objects: BigInt(row.used_objects),
    };
}

async function assert_usage(name, bytes, objects) {
    const row = await usage(name);
    assert.strictEqual(row.bytes, BigInt(bytes), `${name} used_bytes`);
    assert.strictEqual(row.objects, BigInt(objects), `${name} used_objects`);
}

function refresh_cache(name) {
    const bucket = bucket_of(name);
    quota_usage_cache.invalidate({ scope_id: String(bucket._id) });
}

async function inventory(s3, bucket) {
    let bytes = 0;
    let objects = 0;
    let key_marker;
    let version_marker;
    let truncated = true;
    const versions = [];
    const delete_markers = [];
    while (truncated) {
        const page = await s3.listObjectVersions({
            Bucket: bucket,
            KeyMarker: key_marker,
            VersionIdMarker: version_marker,
        });
        for (const version of page.Versions || []) {
            versions.push(version);
            bytes += version.Size;
            objects += 1;
        }
        for (const marker of page.DeleteMarkers || []) {
            delete_markers.push(marker);
            objects += 1;
        }
        truncated = Boolean(page.IsTruncated);
        key_marker = page.NextKeyMarker;
        version_marker = page.NextVersionIdMarker;
    }
    return { bytes, objects, versions, delete_markers };
}

async function assert_matches_bucket(s3, name) {
    const listed = await inventory(s3, name);
    await assert_usage(name, listed.bytes, listed.objects);
    return listed;
}

async function remove_objects(s3, bucket) {
    const listed = await inventory(s3, bucket);
    for (const version of listed.versions) {
        await s3.deleteObject({
            Bucket: bucket,
            Key: version.Key,
            VersionId: version.VersionId,
        });
    }
    for (const marker of listed.delete_markers) {
        await s3.deleteObject({
            Bucket: bucket,
            Key: marker.Key,
            VersionId: marker.VersionId,
        });
    }
    let truncated = true;
    let key_marker;
    while (truncated) {
        const page = await s3.listMultipartUploads({
            Bucket: bucket,
            KeyMarker: key_marker,
        });
        for (const upload of page.Uploads || []) {
            await s3.abortMultipartUpload({
                Bucket: bucket,
                Key: upload.Key,
                UploadId: upload.UploadId,
            });
        }
        truncated = Boolean(page.IsTruncated);
        key_marker = page.NextKeyMarker;
    }
}

async function remove_bucket(s3, name) {
    try {
        await remove_objects(s3, name);
    } catch (err) {
        // The bucket may already be gone.
    }
    try {
        await rpc_client.bucket.delete_bucket_replication({ name });
    } catch (err) {
        // No replication policy is the normal case.
    }
    try {
        await rpc_client.bucket.delete_bucket({ name });
    } catch (err) {
        if (err.rpc_code !== 'NO_SUCH_BUCKET') {
            console.error('delete bucket', name, err.rpc_code || err.message);
        }
    }
    created_buckets.delete(name);
}

async function remove_created_buckets(s3) {
    for (const name of Array.from(created_buckets)) {
        await remove_bucket(s3, name);
    }
}

async function with_buckets(s3, names, fn) {
    for (const name of names) await open_bucket(s3, name);
    try {
        return await fn();
    } finally {
        for (const name of names) await remove_bucket(s3, name);
    }
}

async function upload_part(s3, bucket, key, upload_id, part_number, size, fill) {
    const body = make_body(size, fill);
    const res = await s3.uploadPart({
        Bucket: bucket,
        Key: key,
        UploadId: upload_id,
        PartNumber: part_number,
        Body: body,
    });
    return { ETag: res.ETag, PartNumber: part_number, body };
}

async function reclaim_deleted() {
    const reclaimer = new ObjectsReclaimer({
        name: 'strict-quota-test',
        client: rpc_client,
    });
    await reclaimer.run_batch();
}

async function run_async_quota_cycle() {
    // One aggregator slice that includes objects written before this call.
    // Production waits out MD_GRACE and walks in 30s steps. The snapshot gate
    // is the same once storage_stats has been written. target_now stays at
    // "now" so a delete that happens after this call is left for the next cycle.
    await P.delay(50);
    const saved_interval = config.MD_AGGREGATOR_INTERVAL;
    config.MD_AGGREGATOR_INTERVAL = 10 * 365 * 24 * 60 * 60 * 1000;
    try {
        await md_aggregator.run_md_aggregator(
            MDStore.instance(),
            system_store,
            Date.now(),
            0,
        );
    } finally {
        config.MD_AGGREGATOR_INTERVAL = saved_interval;
    }
    await P.delay(20);
}

async function age_object(name, key, days) {
    const bucket = bucket_of(name);
    const obj = await MDStore.instance().find_object_latest(bucket._id, key);
    assert.ok(obj, `missing object ${key}`);
    const create_time = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
    await MDStore.instance().update_object_by_id(obj._id, { create_time });
}

function midnight_utc(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function run_lifecycle(s3, bucket, prefix) {
    config.LIFECYCLE_SCHEDULE_MIN = 0;
    await s3.putBucketLifecycleConfiguration({
        Bucket: bucket,
        LifecycleConfiguration: {
            Rules: [{
                ID: 'strict-quota-expire',
                Status: 'Enabled',
                Filter: { Prefix: prefix },
                Expiration: { Date: midnight_utc(new Date()) },
            }],
        },
    });
    await lifecycle.background_worker();
}

async function replicate(s3, src, dst) {
    await rpc_client.bucket.put_bucket_replication({
        name: src,
        replication_policy: {
            rules: [{
                rule_id: 'strict-quota',
                destination_bucket: dst,
                sync_versions: false,
            }],
        },
    });
    const original = cloud_utils.set_noobaa_s3_connection;
    cloud_utils.set_noobaa_s3_connection = () => s3;
    try {
        const scanner = new ReplicationScanner({
            name: 'strict-quota-test',
            client: rpc_client,
        });
        await scanner.run_batch();
    } finally {
        cloud_utils.set_noobaa_s3_connection = original;
    }
}

async function bounce_database() {
    const db = db_client.instance();
    await db.disconnect();
    // disconnect() ends the pools but leaves default_pool set, and connect()
    // then returns without opening new pools.
    db.default_pool = null;
    await db.connect();
}

exports.clear_size_scale = clear_size_scale;
exports.bucket_of = bucket_of;
exports.open_bucket = open_bucket;
exports.set_strict = set_strict;
exports.set_async_count = set_async_count;
exports.set_quota_mode = set_quota_mode;
exports.set_versioning = set_versioning;
exports.make_body = make_body;
exports.put_object = put_object;
exports.read_object = read_object;
exports.expect_error = expect_error;
exports.usage = usage;
exports.assert_usage = assert_usage;
exports.refresh_cache = refresh_cache;
exports.inventory = inventory;
exports.assert_matches_bucket = assert_matches_bucket;
exports.remove_bucket = remove_bucket;
exports.remove_created_buckets = remove_created_buckets;
exports.with_buckets = with_buckets;
exports.upload_part = upload_part;
exports.reclaim_deleted = reclaim_deleted;
exports.run_async_quota_cycle = run_async_quota_cycle;
exports.age_object = age_object;
exports.run_lifecycle = run_lifecycle;
exports.replicate = replicate;
exports.bounce_database = bounce_database;
exports.created_buckets = created_buckets;
