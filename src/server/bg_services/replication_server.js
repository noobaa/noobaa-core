/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const system_store = require('../system_services/system_store').get_instance();
const P = require('../../util/promise');
const cloud_utils = require('../../util/cloud_utils');

async function move_objects_by_type(req) {
    const { copy_type } = req.rpc_params;
    switch (copy_type) {
        case 'MIX': {
            const res = await move_object_mixed_types(req);
            console.log('move_objects_by_type: res', res);
            return res;
        }
        default:
            throw new Error('Invalid copy type');
    }
}

async function move_object_mixed_types(req) {
    const { src_bucket_name, dst_bucket_name, keys } = req.rpc_params;
    dbg.log1('replication_server _move_object: params:', src_bucket_name, dst_bucket_name, keys);
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
            dbg.error('replication_server _move_object: got error:', err);
        }
    });
    dbg.log1('replication_server _move_object: finished successfully');
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


exports.move_objects_by_type = move_objects_by_type;
