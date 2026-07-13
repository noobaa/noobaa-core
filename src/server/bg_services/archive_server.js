/* Copyright (C) 2026 NooBaa */
'use strict';

const config = require('../../../config');
const dbg = require('../../util/debug_module')(__filename);
const system_store = require('../system_services/system_store').get_instance();
const pool_server = require('../system_services/pool_server');
const NamespaceS3 = require('../../sdk/namespace_s3');
const noobaa_s3_client = require('../../sdk/noobaa_s3_client/noobaa_s3_client');
const { get_archive_key } = require('../../util/deep_archive_utils');

// Max batch size for S3 DeleteObjects — AWS accepts at most 1000 keys per request.
const S3_DELETE_OBJECTS_BATCH_SIZE = 1000;

/* 
    This function will transition an object from Standard storage class to Deep Archive storage class.
    It will use the endpoint defined by the deep_archive_resource of the bucket.
*/
async function archive_object(req) {
    dbg.log1('archive_object', req.rpc_params);
    throw new Error('archive_object not yet implemented');
}

/**
 * Sets up a NamespaceS3 pointed at the bucket's archive endpoint.
 * Uses get_namespace_resource_extended_info (same as read_bucket_sdk_info)
 * so connection fields are flattened for NamespaceS3.
 * Returns undefined if the bucket has no archive policy or resource.
 * @param {string} bucket_id
 * @returns {NamespaceS3 | undefined}
 */
function setup_archive_ns_for_bucket(bucket_id) {
    const bucket = system_store.data.get_by_id(bucket_id);
    const archive_resource = bucket?.archive_policy?.deep_archive_resource?.resource;
    if (!archive_resource) return;

    const ns_info = pool_server.get_namespace_resource_extended_info(archive_resource);
    if (!ns_info?.endpoint) return;

    return new NamespaceS3({
        namespace_resource_id: ns_info.id,
        bucket: ns_info.target_bucket,
        s3_params: {
            endpoint: ns_info.endpoint,
            aws_sts_arn: ns_info.aws_sts_arn,
            credentials: {
                accessKeyId: ns_info.access_key.unwrap(),
                secretAccessKey: ns_info.secret_key.unwrap(),
            },
            region: ns_info.region || config.DEFAULT_REGION,
            forcePathStyle: true,
            requestHandler: noobaa_s3_client.get_requestHandler_with_suitable_agent(ns_info.endpoint),
            requestChecksumCalculation: 'WHEN_REQUIRED',
            access_mode: ns_info.access_mode,
        },
    });
}

/**
 * Deletes remote archive keys for objects of one bucket.
 * Archive keys are unique per object target_bucket/noobaa_storage/bucket_id/obj_id
 * therefore, no need to specify a specific version).
 * @param {*} req
 * @returns {Promise<{ reclaimed_ids: object[], has_errors: boolean }>}
 */
async function delete_archive_objects(req) {
    const { bucket_id, objects } = req.rpc_params;
    const archive_ns = setup_archive_ns_for_bucket(bucket_id);
    if (!archive_ns) {
        dbg.error(`bucket ${bucket_id} has no archive namespace, skipping ${objects.length} objects`);
        return { reclaimed_ids: [], has_errors: true };
    }

    const reclaimed_ids = [];
    let has_errors = false;
    const bucket = archive_ns.get_bucket();

    for (let start = 0; start < objects.length; start += S3_DELETE_OBJECTS_BATCH_SIZE) {
        const objects_batch = objects.slice(start, start + S3_DELETE_OBJECTS_BATCH_SIZE);
        const archive_keys = objects_batch.map(obj => ({ key: get_archive_key(bucket_id, obj.obj_id) }));
        try {
            const results = await archive_ns.delete_multiple_objects({ bucket, objects: archive_keys }, null);
            const failed = [];
            for (const [i, result] of results.entries()) {
                if (result?.err_code) {
                    failed.push({ key: objects_batch[i].key, archive_key: archive_keys[i].key, ...result });
                } else {
                    reclaimed_ids.push(objects_batch[i].obj_id);
                }
            }
            if (failed.length) {
                has_errors = true;
                dbg.error('failed to delete archive objects for bucket', bucket_id, failed);
            }
        } catch (err) {
            dbg.error('delete_multiple_objects failed for bucket', bucket_id, err);
            has_errors = true;
        }
    }

    return { reclaimed_ids, has_errors };
}

exports.archive_object = archive_object;
exports.setup_archive_ns_for_bucket = setup_archive_ns_for_bucket;
exports.delete_archive_objects = delete_archive_objects;
exports.S3_DELETE_OBJECTS_BATCH_SIZE = S3_DELETE_OBJECTS_BATCH_SIZE;
