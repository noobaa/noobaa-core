/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const system_store = require('../system_services/system_store').get_instance();
const P = require('../../util/promise');
const cloud_utils = require('../../util/cloud_utils');
const replication_utils = require('../utils/replication_utils');

async function copy_objects(req) {
    const { copy_type } = req.rpc_params;
    switch (copy_type) {
        case 'MIX': {
            const res = await copy_objects_mixed_types(req);
            dbg.log0('move_objects_by_type: res', res);
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

    const bucket = system_store.data.systems[0].buckets_by_name[bucket_name.unwrap()];
    const noobaa_con = replication_utils.set_noobaa_s3_connection_for_bucket(bucket) ||
        cloud_utils.set_noobaa_s3_connection(system_store.data.systems[0]);
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
            });

            res.Deleted?.forEach(obj => delete_done_list.push(obj.Key));
        } catch (err) {
            dbg.error('replication_server delete_objects: got error:', err);
        }
    });

    dbg.log1('replication_server delete_objects: finished successfully');
    return delete_done_list;
}

async function copy_objects_mixed_types(req) {
    const { src_bucket_name, dst_bucket_name, keys_diff_map } = req.rpc_params;
    dbg.log1('replication_server copy_objects_mixed_types: params:', src_bucket_name, dst_bucket_name, keys_diff_map);
    const copy_res = {
        num_of_objects: 0,
        size_of_objects: 0
    };
    const keys = Object.keys(keys_diff_map);

    const src_name = src_bucket_name.unwrap();
    const dst_name = dst_bucket_name.unwrap();
    const src_bucket = system_store.data.systems[0].buckets_by_name[src_name];
    const dst_bucket = system_store.data.systems[0].buckets_by_name[dst_name];
    const sys_connection = cloud_utils.set_noobaa_s3_connection(system_store.data.systems[0]);
    const { src: src_con, dst: dst_con } = replication_utils.s3_connections_for_replication(src_bucket, dst_bucket, sys_connection);
    if (!src_con || !dst_con) throw new Error('noobaa endpoint connection is not started yet...');
    await P.map_with_concurrency(100, keys, async key => { //The concurrency can only be on the keys as the order of the versions matters
        const objects = keys_diff_map[key];
        for (let i = objects.length - 1; i >= 0; i--) { // oldest version first
            const version_id = objects.length === 1 ? undefined : objects[i].VersionId;
            // Size from ListObjectVersions, ContentLength from HeadObject
            const size = objects[i].ContentLength || objects[i].Size;
            try {
                const get_params = { Bucket: src_name, Key: key };
                if (version_id) get_params.VersionId = version_id;
                const obj = await src_con.getObject(get_params);
                await dst_con.putObject({
                    Bucket: dst_name,
                    Key: key,
                    Body: obj.Body,
                    ContentType: obj.ContentType,
                    ContentLength: obj.ContentLength ?? size,
                    Metadata: obj.Metadata,
                    ContentEncoding: obj.ContentEncoding,
                });
                copy_res.num_of_objects += 1;
                copy_res.size_of_objects += size;
            } catch (err) {
                dbg.error('replication_server copy_objects_mixed_types: got error:', err);
            }
        }
    });
    dbg.log1('replication_server copy_objects_mixed_types: finished successfully');
    return copy_res;
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
