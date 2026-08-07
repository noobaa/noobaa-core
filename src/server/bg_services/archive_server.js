/* Copyright (C) 2026 NooBaa */
'use strict';

const config = require('../../../config');
const dbg = require('../../util/debug_module')(__filename);
const system_store = require('../system_services/system_store').get_instance();
const pool_server = require('../system_services/pool_server');
const NamespaceS3 = require('../../sdk/namespace_s3');
const noobaa_s3_client = require('../../sdk/noobaa_s3_client/noobaa_s3_client');
const LRUCache = require('../../util/lru_cache');
const { get_archive_key, parse_s3_restore_field } = require('../../util/deep_archive_utils');

// Max batch size for S3 DeleteObjects — AWS accepts at most 1000 keys per request.
const S3_DELETE_OBJECTS_BATCH_SIZE = 1000;


const archive_ns_cache = new LRUCache({
    name: 'ArchiveNamespaceCache',
    expiry_ms: config.ARCHIVE_NS_CACHE_EXPIRY_MS,
    max_usage: config.ARCHIVE_NS_CACHE_MAX_USAGE,
    make_key: ({ nsr_id }) => String(nsr_id),
    load: async ({ ns_info }) => create_archive_ns_from_info(ns_info),
    validate: (ns, { ns_info }) => (
        ns.endpoint === ns_info.endpoint &&
        ns.access_key === ns_info.access_key.unwrap()
    ),
});

/* 
    This function will transition an object from Standard storage class to Deep Archive storage class.
    It will use the endpoint defined by the deep_archive_resource of the bucket.
*/
async function archive_object(req) {
    dbg.log1('archive_object', req.rpc_params);
    throw new Error('archive_object not yet implemented');
}

/**
 * Resolves extended namespace-resource info for the bucket's deep-archive resource.
 * Returns undefined if the bucket has no archive policy or the resource has no endpoint.
 * @param {string} bucket_id
 * @returns {object|undefined}
 */
function get_archive_ns_info_for_bucket(bucket_id) {
    const bucket = system_store.data.get_by_id(bucket_id);
    const archive_resource = bucket?.archive_policy?.deep_archive_resource?.resource;
    if (!archive_resource) return;

    const ns_info = pool_server.get_namespace_resource_extended_info(archive_resource);
    if (!ns_info?.endpoint) return;
    return ns_info;
}

/**
 * Builds a NamespaceS3 from extended namespace-resource info (target_bucket and connection fields).
 * @param {object} ns_info
 * @returns {NamespaceS3}
 */
function create_archive_ns_from_info(ns_info) {
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
    const ns_info = get_archive_ns_info_for_bucket(bucket_id);
    if (!ns_info) {
        dbg.error(`bucket ${bucket_id} has no archive namespace, skipping ${objects.length} objects`);
        return { reclaimed_ids: [], has_errors: true };
    }
    const archive_ns = await archive_ns_cache.get_with_cache({ nsr_id: ns_info.id, ns_info });

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

/**
 * Heads the archive object and reports whether deep archive restore has completed.
 * @param {*} req
 * @returns {Promise<{ is_restored: boolean, archive_key: string, restore_field?: string, size?: number }>}
 */
async function check_archive_restore_status(req) {
    const { bucket_id, obj_id } = req.rpc_params;
    const archive_key = get_archive_key(bucket_id, obj_id);
    const ns_info = get_archive_ns_info_for_bucket(bucket_id);
    if (!ns_info) {
        dbg.error(`bucket ${bucket_id} has no archive namespace for restore check`, archive_key);
        throw new Error(`bucket ${bucket_id} has no archive namespace`);
    }
    const archive_ns = await archive_ns_cache.get_with_cache({ nsr_id: ns_info.id, ns_info });

    try {
        const head_object_res = await archive_ns.s3.headObject({
            Bucket: archive_ns.get_bucket(),
            Key: archive_key,
        });
        const parsed_restore_field = parse_s3_restore_field(head_object_res.Restore);
        const is_restored = Boolean(parsed_restore_field && !parsed_restore_field.ongoing);
        return {
            is_restored,
            archive_key,
            restore_field: head_object_res.Restore,
            size: head_object_res.ContentLength,
        };
    } catch (err) {
        dbg.error('check_archive_restore_status failed', archive_key, err);
        throw err;
    }
}

exports.archive_object = archive_object;
exports.delete_archive_objects = delete_archive_objects;
exports.check_archive_restore_status = check_archive_restore_status;
