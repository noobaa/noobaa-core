/* Copyright (C) 2026 NooBaa */
'use strict';

const { RpcError } = require('../../rpc');
const config = require('../../../config');
const server_rpc = require('../server_rpc');
const ObjectIO = require('../../sdk/object_io');
const LRUCache = require('../../util/lru_cache');
const ObjectSDK = require('../../sdk/object_sdk');
const NamespaceS3 = require('../../sdk/namespace_s3');
const { ARCHIVE } = require('../../common/constants');
const utils = require('../../util/deep_archive_utils');
const dbg = require('../../util/debug_module')(__filename);
const auth_server = require('../common_services/auth_server');
const pool_server = require('../system_services/pool_server');
const { get_archive_key } = require('../../util/deep_archive_utils');
const { map_with_concurrency_and_attempts } = require('../../util/promise');
const system_store = require('../system_services/system_store').get_instance();
const noobaa_s3_client = require('../../sdk/noobaa_s3_client/noobaa_s3_client');

/* S3 multipart upload size is limited by 5GB. Each multipart upload size 
is currently configured by max part size in IO pipeline */
const PART_SIZE = config.MAX_OBJECT_PART_SIZE;
const MULTIPART_UPLOAD_SIZE = config.MULTIPART_PARTS_COUNT * PART_SIZE;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

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

/**
 * Archives an object by copying its contents from the source object storage
 * into the bucket's configured archive namespace using multipart upload.
 *
 * @param {Object} req
 *
 * @returns {Promise<{success: boolean}>}
 *   Resolves with `{ success: true }` when the archive upload completes
 *   successfully.
 *
 * @throws {RpcError}
 *   Throws `INVALID_TRANSITION_TARGET_STORAGE_CLASS` when the requested
 *   storage class is not supported.
 * @throws {RpcError}
 *   Throws `UNAUTHORIZED` when the archive namespace is read-only.
 * @throws {Error}
 *   For all other errors
 *
 * @description
 * Source object data is read as streams from the original object storage and
 * uploaded as multipart ranges to the archive namespace. Multipart uploads
 * are performed concurrently with retry handling. If the operation fails,
 * the in-progress archive multipart upload is aborted.
 */
async function archive_object(req) {
    const { obj_id, bucket_id, target_storage_class } = req.rpc_params;
    try {
        dbg.log1('archive_object: starting', obj_id, bucket_id, target_storage_class);

        if (!Object.keys(ARCHIVE.STORAGE_CLASS).includes(target_storage_class)) {
            throw new RpcError('INVALID_TRANSITION_TARGET_STORAGE_CLASS',
                `target storage class should be one of: ${Object.keys(ARCHIVE.STORAGE_CLASS)}`);
        }

        const auth_token = auth_server.make_auth_token({
            system_id: req.system._id,
            account_id: req.account._id,
            role: 'admin',
        });
        const { rpc } = server_rpc;
        const rpc_client = rpc.new_client({ auth_token });
        const internal_rpc_client = rpc.new_client({ auth_token });
        const object_io = new ObjectIO();
        const object_sdk = new ObjectSDK({
            rpc_client,
            internal_rpc_client,
            object_io,
        });

        const obj_md = await rpc_client.object.read_object_md_by_id({
            obj_id,
        });
        if (!obj_md) {
            throw new Error('archive_object: object not found ' + obj_id);
        }

        const object_md = {
            obj_id: obj_md.obj_id,
            bucket: obj_md.bucket,
            key: obj_md.key,
            size: obj_md.size,
            encryption: obj_md.encryption,
        };

        const { chunks } = await rpc_client.object.read_object_mapping({
            bucket: obj_md.bucket,
            key: obj_md.key,
            obj_id: obj_md.obj_id,
            size: obj_md.size,
            start: 0,
            end: obj_md.size,
        });

        if (!chunks?.length) {
            throw new Error('archive_object: unable to fetch chunks for ' + obj_id);
        }

        const dest_ns = await get_archive_ns_for_bucket(bucket_id);
        if (!dest_ns) {
            dbg.error(`archive_object: bucket ${bucket_id} has no archive namespace`);
            throw new Error(`archive_object: bucket ${bucket_id} has no archive namespace`);
        } else if (dest_ns.is_readonly_namespace()) {
            throw new RpcError('UNAUTHORIZED', 'archive object requires a writable archive namespace');
        }

        // when storing object on deep_archive, use a composite key to avoid collisions
        const object_key = utils.get_archive_key(bucket_id, obj_id);
        const { obj_id: upload_id } = await dest_ns.create_object_upload({
            bucket: dest_ns.bucket,
            key: object_key,
            content_type: obj_md.content_type,
            storage_class: target_storage_class,
            xattr: obj_md.xattr,
        }, object_sdk);

        dbg.log1('archive_object: multipart upload initiated', upload_id);

        const multipart_ranges = calculate_multipart_range(chunks);
        const multiparts = [];
        try {
            const results = await map_with_concurrency_and_attempts(config.MULTIPART_CONCURRENCY,
                MAX_ATTEMPTS, RETRY_DELAY_MS, multipart_ranges, async r => {
                    try {
                        const source_stream = object_io.read_object_stream({
                            client: rpc_client,
                            object_md: object_md,
                            start: r.start,
                            end: r.end,
                        });

                        const { etag } = await dest_ns.upload_multipart({
                            bucket: dest_ns.bucket,
                            key: object_key,
                            obj_id: upload_id,
                            num: r.part_num,
                            size: r.size,
                            source_stream: source_stream,
                        }, object_sdk);

                        dbg.log1('archive_object: uploaded part', r.part_num, 'etag', etag);
                        multiparts.push({ num: r.part_num, etag });
                        return true;
                    } catch (err) {
                        dbg.error('archive_object: multipart upload failed', err);
                        throw err;
                    }
                });

            multiparts.sort((a, b) => a.num - b.num);
            const { etag } = await dest_ns.complete_object_upload({
                bucket: dest_ns.bucket,
                key: object_key,
                obj_id: upload_id,
                multiparts,
            }, object_sdk);

            dbg.log1('archive_object: completed multipart upload', object_key, 'etag', etag);
            dbg.log1('archive_object: result', results);
            return { success: true };
        } catch (e) {
            dbg.error("error performing multipart upload for key", object_key,
                "bucket", bucket_id, "error", e);
            await dest_ns.abort_object_upload({
                bucket: dest_ns.bucket,
                key: object_key,
                obj_id: upload_id,
            }, object_sdk).catch(err => {
                dbg.error("error aborting multipart upload for key", object_key,
                    "bucket", bucket_id, "error", err);
            });
            throw e;
        }
    } catch (e) {
        dbg.error(`archive_object failed for object ${obj_id} with error:`, e);
        if (e instanceof RpcError) {
            throw e;
        }
        throw new Error('archive_object: internal_error', { cause: e });
    }

}

/**
 * Calculates contiguous multipart upload ranges from a collection of chunks.
 * It iterates through chunks sequentially, accumulating consecutive
 * chunk byte ranges into a single multipart part. When adding the next chunk
 * would exceed MULTIPART_UPLOAD_SIZE, the accumulated range is finalized as
 * one part and a new accumulation begins
 * starting from that chunk.
 *
 * This effectively re-segments the object's internal chunk layout into
 * S3-compatible multipart upload parts suitable for uploading to an archive
 * target. Each returned range specifies the byte offsets (start, end) and
 * size to read from the source object, along with the sequential part number
 * for the multipart upload.
 *
 * @param {Array<{parts: Array<{start: number, end: number}>}>} chunks
 *     The chunks to group into multipart upload ranges. Each chunk is expected
 *     to contain at least one part in its `parts` array.
 *
 * @returns {Array<{
 *   start: number,
 *   end: number,
 *   size: number,
 *   part_num: number
 * }>} The calculated multipart upload ranges.
 */
function calculate_multipart_range(chunks) {
    let size = 0;
    let start = 0;
    let end = 0;
    let part_num = 1;
    const multipart_ranges = [];
    for (const chunk of chunks) {
        const part = chunk.parts[0];
        if (!part) {
            throw new Error('found an invalid chunk while calculating multipart range', chunk);
        }
        const part_size = part.end - part.start;
        if (size + part_size <= MULTIPART_UPLOAD_SIZE) {
            end = part.end;
            size += part_size;
            continue;
        }

        if (size > 0) {
            multipart_ranges.push({
                start,
                end,
                size,
                part_num,
            });
            part_num += 1;
        }
        size = part_size;
        start = part.start;
        end = part.end;
    }

    if (size > 0) {
        multipart_ranges.push({
            start,
            end,
            size,
            part_num,
        });
    }
    return multipart_ranges;
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
 * Returns a cached NamespaceS3 for the bucket's deep-archive resource.
 * @param {string} bucket_id
 * @returns {Promise<NamespaceS3|undefined>}
 */
async function get_archive_ns_for_bucket(bucket_id) {
    const ns_info = get_archive_ns_info_for_bucket(bucket_id);
    if (!ns_info) return;
    return archive_ns_cache.get_with_cache({ nsr_id: ns_info.id, ns_info });
}

/**
 * Deletes remote archive keys for objects of one bucket.
 * Archive keys are unique per object target_bucket/noobaa_storage/bucket_id/obj_id
 * therefore, no need to specify a specific version).
 * @param {*} req
 * @returns {Promise<{ reclaimed_ids: object[], had_errors: boolean }>}
 */
async function delete_archive_objects(req) {
    const { bucket_id, objects } = req.rpc_params;
    const ns_info = get_archive_ns_info_for_bucket(bucket_id);
    if (!ns_info) {
        dbg.error(`bucket ${bucket_id} has no archive namespace, skipping ${objects.length} objects`);
        return { reclaimed_ids: [], had_errors: true };
    }
    const archive_ns = await archive_ns_cache.get_with_cache({ nsr_id: ns_info.id, ns_info });

    const reclaimed_ids = [];
    let had_errors = false;
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
                had_errors = true;
                dbg.error('failed to delete archive objects for bucket', bucket_id, failed);
            }
        } catch (err) {
            dbg.error('delete_multiple_objects failed for bucket', bucket_id, err);
            had_errors = true;
        }
    }

    return { reclaimed_ids, had_errors };
}

/**
 * Heads the archive object and reports whether deep archive restore has completed.
 * @param {*} req
 * @returns {Promise<{ is_restored: boolean, archive_key: string, size?: number }>}
 */
async function check_archive_restore_status(req) {
    const { bucket_id, obj_id } = req.rpc_params;
    const archive_key = get_archive_key(bucket_id, obj_id);
    const archive_ns = await get_archive_ns_for_bucket(bucket_id);
    if (!archive_ns) {
        dbg.error(`bucket ${bucket_id} has no archive namespace for restore check`, archive_key);
        throw new Error(`bucket ${bucket_id} has no archive namespace`);
    }

    try {
        const object_md = await archive_ns.read_object_md({
            bucket: archive_ns.get_bucket(),
            key: archive_key,
            use_head_object: true, // force use of HeadObject instead of GetObject
        }, undefined); // undefined for object_sdk (no need to update issues reporting)
        const is_restored = Boolean(object_md.restore_status && !object_md.restore_status.ongoing);
        return {
            is_restored,
            archive_key,
            size: object_md.size,
        };
    } catch (err) {
        dbg.error('check_archive_restore_status failed', archive_key, err);
        throw err;
    }
}

/**
 * Opens a GetObject stream for the object's deep-archive key.
 * Call this in-process (require + function call), not via rpc_client.archive.
 * Archive RPC replies are JSON only and cannot carry a live Node.js Readable,
 * so the restore worker streams bytes by calling this helper in the same process.
 * @param {{ bucket_id: string|nb.ID, obj_id: string|nb.ID, size: number }} params
 * @returns {Promise<import('stream').Readable>}
 */
async function read_archive_object_stream({ bucket_id, obj_id, size }) {
    const archive_key = get_archive_key(bucket_id, obj_id);
    const archive_ns = await get_archive_ns_for_bucket(bucket_id);
    if (!archive_ns) {
        dbg.error(`bucket ${bucket_id} has no archive namespace for read`, archive_key);
        throw new Error(`bucket ${bucket_id} has no archive namespace`);
    }

    try {
        return await archive_ns.read_object_stream({
            bucket: archive_ns.get_bucket(),
            key: archive_key,
            size,
        }, undefined);
    } catch (err) {
        dbg.error('read_archive_object_stream failed', archive_key, err);
        throw err;
    }
}

/**
 * Aborts an in-progress multipart upload on a deep-archive namespace resource.
 * Best-effort: treats already-aborted / missing uploads, and a missing archive
 * namespace, as success so reclaim can proceed.
 * @param {object} req
 * @param {{ bucket_id: string|nb.ID, obj_id: string|nb.ID, upload_id: string }} req.rpc_params
 * @returns {Promise<void>}
 */
async function abort_archive_multipart_upload(req) {
    const { bucket_id, obj_id, upload_id } = req.rpc_params;
    dbg.log1('abort_archive_multipart_upload', { bucket_id, obj_id, upload_id });

    const archive_ns = await get_archive_ns_for_bucket(bucket_id);
    if (!archive_ns) {
        dbg.warn('abort_archive_multipart_upload: no archive namespace resource on bucket, skipping', { bucket_id, obj_id, upload_id });
        return;
    }

    const archive_key = get_archive_key(bucket_id, obj_id);
    const target_bucket = archive_ns.get_bucket();
    const abort_archive_mpu_params = { bucket: target_bucket, key: archive_key, obj_id: upload_id };
    try {
        dbg.log1('abort_archive_multipart_upload: aborting on deep archive namespace', abort_archive_mpu_params);
        await archive_ns.abort_object_upload(abort_archive_mpu_params, null);
    } catch (err) {
        if (['NO_SUCH_UPLOAD', 'NO_SUCH_OBJECT'].includes(err.rpc_code)) {
            dbg.warn('abort_archive_multipart_upload: multipart upload not found, skipping', abort_archive_mpu_params);
            return;
        }
        throw err;
    }
}

exports.archive_object = archive_object;
exports.delete_archive_objects = delete_archive_objects;
exports.check_archive_restore_status = check_archive_restore_status;
exports.read_archive_object_stream = read_archive_object_stream;
exports.abort_archive_multipart_upload = abort_archive_multipart_upload;
