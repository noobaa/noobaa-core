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
    const { src_bucket_name, dst_bucket_name, keys } = req.rpc_params;
    dbg.log1('replication_server copy_objects_mixed_types: params:', src_bucket_name, dst_bucket_name, keys);
    const copy_done_list = [];

    const noobaa_con = cloud_utils.set_noobaa_s3_connection(system_store.data.systems[0]);
    if (!noobaa_con) throw new Error('noobaa endpoint connection is not started yet...');
    await P.map_with_concurrency(100, keys, async key => {
        const params = {
            Bucket: dst_bucket_name.unwrap(),
            CopySource: `/${src_bucket_name.unwrap()}/${key}`, // encodeURI for special chars is needed
            Key: key
        };
        try {
            await noobaa_con.copyObject(params).promise();
            copy_done_list.push(key);
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
exports.copy_objects_mixed_types = copy_objects_mixed_types;
exports.delete_objects = delete_objects;
