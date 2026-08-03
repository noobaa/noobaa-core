/* Copyright (C) 2026 NooBaa */
'use strict';

const { RpcError } = require('../../rpc');
const config = require('../../../config');
const server_rpc = require('../server_rpc');
const ObjectIO = require('../../sdk/object_io');
const ObjectSDK = require('../../sdk/object_sdk');
const NamespaceS3 = require('../../sdk/namespace_s3');
const { ARCHIVE } = require('../../common/constants');
const utils = require('../../util/deep_archive_utils');
const dbg = require('../../util/debug_module')(__filename);
const { MDStore } = require('../object_services/md_store');
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

/* 
    This function will transition an object from Standard storage class to Deep Archive storage class.
    It will use the endpoint defined by the deep_archive_resource of the bucket.
*/
async function archive_object(req) {
    try {
        const { obj_id, bucket_id, storage_class } = req.rpc_params;
        dbg.log1('archive_object: starting', obj_id, bucket_id, storage_class);

        if (!Object.keys(ARCHIVE.STORAGE_CLASS).includes(storage_class)) {
            throw new RpcError('INVALID_ARGUMENTS',
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

        const obj_md = await MDStore.instance().find_object_by_id(
            MDStore.instance().make_md_id(obj_id)
        );

        if (!obj_md) {
            throw new Error('archive_object: object not found ' + obj_id);
        }

        const bucket = system_store.data.get_by_id(bucket_id);
        if (!bucket) {
            throw new Error('archive_object: bucket not found ' + bucket_id);
        }

        const object_md = {
            obj_id: obj_md._id.toHexString(),
            bucket: bucket.name,
            key: obj_md.key,
            size: obj_md.size,
            encryption: obj_md.encryption,
        };

        const { chunks } = await rpc_client.object.read_object_mapping({
            bucket: bucket.name,
            key: obj_md.key,
            obj_id: obj_md._id,
            size: obj_md.size,
            start: 0,
            end: obj_md.size,
        });

        if (!chunks?.length) {
            throw new Error('archive_object: unable to fetch chunks for ' + obj_id);
        }

        const dest_ns = setup_archive_ns_for_bucket(bucket_id);

        // when storing object on deep_archive, use a composite key to avoid collisions
        const object_key = utils.get_archive_key(bucket_id, obj_id);
        const { obj_id: upload_id } = await dest_ns.create_object_upload({
            bucket: dest_ns.bucket,
            key: object_key,
            content_type: obj_md.content_type,
            storage_class: storage_class,
            xattr: obj_md.xattr,
        }, object_sdk);

        dbg.log1('archive_object: multipart upload initiated', upload_id);

        let size = 0;
        let start = 0;
        let end = 0;
        let part_num = 1;
        const multipart_ranges = [];
        for (const chunk of chunks) {
            const part = chunk.parts[0];
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
        throw new Error('archive_object: internal_error', { cause: e });
    }

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
exports.delete_archive_objects = delete_archive_objects;
