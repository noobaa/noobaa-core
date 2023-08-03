/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const system_store = require('../system_services/system_store').get_instance();
const P = require('../../util/promise');
const cloud_utils = require('../../util/cloud_utils');

async function copy_objects(req) {
    const { copy_type } = req.rpc_params;
    switch (copy_type) {
        case 'MIX': {
            const res = await copy_objects_mixed_types(req);
            console.log('move_objects_by_type: res', res);
            return res;
        }
        default:
            throw new Error('Invalid copy type');
    }
}

async function multipart_upload(src_bucket_name, dst_bucket_name, object) {
    dbg.log1('replication_server multipart_upload: params:', src_bucket_name, dst_bucket_name, object.key);

    const noobaa_con = cloud_utils.set_noobaa_s3_connection(system_store.data.systems[0]);
    if (!noobaa_con) throw new Error('noobaa endpoint connection is not started yet...');
    try {
        // Initiate the multipart upload.
        const init_request = {
            Bucket: dst_bucket_name,
            Key: object.key
        };
        const init_result = await noobaa_con.createMultipartUpload(init_request).promise();

        // Get the object size to track the end of the copy operation.
        const object_size = object.content_length;

        // Copy the object using 5 MB parts.
        const part_size = 5 * 1024 * 1024;
        let byte_position = 0;
        let part_num = 1;
        const copy_response = [];
        while (byte_position < object_size) {
            // The last part might be smaller than partSize, so check to make sure
            // that lastByte isn't beyond the end of the object.
            const lastByte = Math.min(byte_position + part_size - 1, object_size - 1);

            // Copy this part.
            const copy_request = {
                Bucket: dst_bucket_name,
                CopySource: `/${src_bucket_name.unwrap()}/${object.key}`,
                Key: dst_bucket_name,
                UploadId: init_result.UploadId,
                PartNumber: part_num,
                CopySourceRange: `bytes=${byte_position}-${lastByte}`
            };
            const copy_result = await noobaa_con.uploadPartCopy(copy_request).promise();
            copy_response.push(copy_result);
            byte_position += part_size;
            part_num += 1;
        }
        // Complete the upload request to concatenate all uploaded parts and make the copied object available.
        const complete_request = {
            Bucket: dst_bucket_name,
            Key: object.key,
            UploadId: init_result.UploadId,
            MultipartUpload: {
                Parts: copy_response.map((response, index) => ({
                    ETag: response.CopyPartResult.ETag,
                    PartNumber: index + 1
                }))
            }
        };
        await noobaa_con.completeMultipartUpload(complete_request).promise();
    } catch (err) {
        dbg.error('replication_server multipart_upload: got error:', err);
    }

    dbg.log1('replication_server multipart_upload: finished successfully');
}

/**
 * delete_objects takes in an array of keys and deletes them from the bucket
 * @param {*} req request object
 * @returns 
 */
async function delete_objects(req) {
    const { bucket_name, keys } = req.rpc_params;
    dbg.log1('replication_server delete_objects: params:', bucket_name, keys);
    const delete_done_list = [];

    const noobaa_con = cloud_utils.set_noobaa_s3_connection(system_store.data.systems[0]);
    if (!noobaa_con) throw new Error('noobaa endpoint connection is not started yet...');

    // batch size is 1000
    const batch_size = 1000;

    // split the keys into batches of 1000
    const key_batches = keys?.reduce((acc, key, index) => {
        const batch_index = Math.floor(index / batch_size);

        if (!acc[batch_index]) acc[batch_index] = [];
        acc[batch_index].push(key);

        return acc;
    }, []) || [];

    await P.map_with_concurrency(100, key_batches, async batch => {
        try {
            const res = await noobaa_con.deleteObjects({
                Bucket: bucket_name.unwrap(),
                Delete: {
                    Objects: batch.map(key => ({ Key: key }))
                }
            }).promise();

            res.Deleted?.forEach(obj => delete_done_list.push(obj.Key));
        } catch (err) {
            dbg.error('replication_server delete_objects: got error:', err);
        }
    });

    dbg.log1('replication_server delete_objects: finished successfully');
    return delete_done_list;
}

async function copy_objects_mixed_types(req) {
    const { src_bucket_name, dst_bucket_name, objects } = req.rpc_params;
    dbg.log1('replication_server copy_objects_mixed_types: params:', src_bucket_name, dst_bucket_name, objects);
    const copy_done_list = [];

    const noobaa_con = cloud_utils.set_noobaa_s3_connection(system_store.data.systems[0]);
    if (!noobaa_con) throw new Error('noobaa endpoint connection is not started yet...');
    await P.map_with_concurrency(100, objects, async object => {
        const params = {
            Bucket: dst_bucket_name.unwrap(),
            CopySource: `/${src_bucket_name.unwrap()}/${object.key}`, // encodeURI for special chars is needed
            Key: object.key
        };
        try {
            if (object.content_length <= 5 * 1024 * 1024 * 1024) {
                await noobaa_con.copyObject(params).promise();
            } else {
                await multipart_upload(src_bucket_name, dst_bucket_name, object);
            }

            copy_done_list.push(object.key);
        } catch (err) {
            dbg.error('replication_server copy_objects_mixed_types: got error:', err);
        }
    });
    dbg.log1('replication_server copy_objects_mixed_types: finished successfully');
    return copy_done_list;
}

////////////////////////////////////////////
///// SERVER SIDE MOVERS OPTIMIZATIONS /////
////////////////////////////////////////////
/*
async function _move_objects_noobaa(src_bucket, dst_bucket, objects_list) {
    throw new Error('TODO');
}

async function _move_objects_aws(src_bucket, dst_bucket, objects_list) {
    throw new Error('TODO');
}

async function _move_objects_azure(src_bucket, dst_bucket, objects_list) {
    throw new Error('TODO');
}*/


exports.copy_objects = copy_objects;
exports.multipart_upload = multipart_upload;
exports.copy_objects_mixed_types = copy_objects_mixed_types;
exports.delete_objects = delete_objects;
