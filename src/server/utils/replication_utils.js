/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const dbg = require('../../util/debug_module')(__filename);
const system_store = require('../system_services/system_store').get_instance();
const auth_server = require('../common_services/auth_server');

function check_data_or_md_changed(src_info, dst_info) {
    dbg.log1('replication_utils.check_data_or_md_changed:', src_info, dst_info);

    // when object in dst bucket is more recent - we don't want to override it so we do not
    // execute replication of object
    const src_last_modified_recent = src_info.LastModified >= dst_info.LastModified;
    if (!src_last_modified_recent) return false;

    // data change - replicate the object
    const data_change = src_info.ContentLength !== dst_info.ContentLength || src_info.ETag !== dst_info.ETag;
    if (data_change) return true;

    // md change - head objects and compare metadata, if metadata is different - copy object
    if (!_.isEqual(src_info.Metadata, dst_info.Metadata)) return true;

    // data and md is equal which means something else changed in src
    // nothing to do 
    return false;
}

async function get_object_md(noobaa_connection, bucket_name, key) { //TODO: need to remove it once removing from replication scanner
    try {
        dbg.log1('replication_utils get_object_md: params:', bucket_name.unwrap(), key);
        const head = await noobaa_connection.headObject({
            Bucket: bucket_name.unwrap(),
            Key: key,
        }).promise();

        dbg.log1('replication_utils.get_object_md: finished successfully', head);
        return head;
    } catch (err) {
        dbg.error('replication_utils.get_object_md: error:', err);
        throw err;
    }
}

function find_src_and_dst_buckets(dst_bucket_id, replication_id) {
    const ans = _.reduce(system_store.data.buckets, (acc, cur_bucket) => {
        dbg.log1('replication_utils.find_src_and_dst_buckets: ', cur_bucket._id, dst_bucket_id, cur_bucket.replication_policy_id, replication_id);
        if (cur_bucket._id.toString() === dst_bucket_id.toString()) acc.dst_bucket = cur_bucket;
        if (cur_bucket.replication_policy_id &&
            (cur_bucket.replication_policy_id.toString() === replication_id.toString())) {
            acc.src_bucket = cur_bucket;
        }
        return acc;
    }, { src_bucket: undefined, dst_bucket: undefined });

    return ans;
}

function get_copy_type() {
    // TODO: get copy type by src and dst buckets (for server side/other optimization)
    return 'MIX';
}

async function copy_objects(scanner_semaphore, client, copy_type, src_bucket_name, dst_bucket_name, keys) {
    try {
        const res = await scanner_semaphore.surround_count(keys.length,
            async () => {
                try {
                    const res1 = await client.replication.copy_objects({
                        copy_type,
                        src_bucket_name,
                        dst_bucket_name,
                        keys
                    }, {
                        auth_token: auth_server.make_auth_token({
                            system_id: system_store.data.systems[0]._id,
                            account_id: system_store.data.systems[0].owner._id,
                            role: 'admin'
                        })
                    });
                    return res1;
                } catch (err) {
                    // no need to do retries, eventually the object will be uploaded
                    // TODO: serious error codes with metrics (auth_failed, storage not exist etc)
                    dbg.error('replication_utils copy_objects: error: ', err, src_bucket_name, dst_bucket_name, keys);
                }
            });
        return res;
    } catch (err) {
        dbg.error('replication_utils copy_objects: semaphore error:', err, err.stack);
        // no need to handle semaphore errors, eventually the object will be uploaded
    }
}

async function delete_objects(scanner_semaphore, client, bucket_name, keys) {
    try {
        const res = await scanner_semaphore.surround_count(keys.length,
            async () => {
                try {
                    const res1 = await client.replication.delete_objects({
                        bucket_name,
                        keys
                    }, {
                        auth_token: auth_server.make_auth_token({
                            system_id: system_store.data.systems[0]._id,
                            account_id: system_store.data.systems[0].owner._id,
                            role: 'admin'
                        })
                    });
                    return res1;
                } catch (err) {
                    dbg.error('replication_utils delete_objects: error: ', err, bucket_name, keys);
                }
            });
        return res;
    } catch (err) {
        dbg.error('replication_utils delete_objects: semaphore error:', err, err.stack);
    }
}

// EXPORTS
exports.check_data_or_md_changed = check_data_or_md_changed;
exports.get_object_md = get_object_md;
exports.find_src_and_dst_buckets = find_src_and_dst_buckets;
exports.get_copy_type = get_copy_type;
exports.copy_objects = copy_objects;
exports.delete_objects = delete_objects;
