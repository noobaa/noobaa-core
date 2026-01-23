/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const dbg = require('../../util/debug_module')(__filename);
const SensitiveString = require('../../util/sensitive_string');
const system_store = require('../system_services/system_store').get_instance();
const prom_reporting = require('../analytic_services/prometheus_reporting');
const auth_server = require('../common_services/auth_server');

const PARTIAL_SINGLE_BUCKET_REPLICATION_DEFAULTS = {
    replication_id: '',
    last_cycle_rule_id: '',
    bucket_name: '',
    last_cycle_writes_num: 0,
    last_cycle_writes_size: 0,
    last_cycle_error_writes_num: 0,
    last_cycle_error_writes_size: 0,
    bucket_last_cycle_total_objects_num: 0,
    bucket_last_cycle_replicated_objects_num: 0,
    bucket_last_cycle_error_objects_num: 0,
};

//TODO: this function is not being used anymore, commenting out and keeping it as reference 
// function check_data_or_md_changed(src_info, dst_info) {
//     dbg.log1('replication_utils.check_data_or_md_changed:', src_info, dst_info);

//     // when object in dst bucket is more recent - we don't want to override it so we do not
//     // execute replication of object
//     const src_last_modified_recent = src_info.LastModified >= dst_info.LastModified;
//     if (!src_last_modified_recent) return false;

//     // data change - replicate the object
//     const data_change = src_info.ContentLength !== dst_info.ContentLength || src_info.ETag !== dst_info.ETag;
//     if (data_change) return true;

//     // md change - head objects and compare metadata, if metadata is different - copy object
//     if (!_.isEqual(src_info.Metadata, dst_info.Metadata)) return true;

//     // data and md is equal which means something else changed in src
//     // nothing to do 
//     return false;
// }

function get_rule_and_bucket_status(rule, src_cont_token, keys_diff_map, copy_res) {
    const { num_keys_to_copy, num_bytes_to_copy } = Object.entries(keys_diff_map).reduce(
        (acc, [key, value]) => {
            acc.num_keys_to_copy += value.length;
            acc.num_bytes_to_copy += value.reduce((key_bytes, obj) => key_bytes + obj.Size, 0);
            return acc;
        }, { num_keys_to_copy: 0, num_bytes_to_copy: 0 }
    );

    const num_keys_moved = copy_res.num_of_objects;
    const num_bytes_moved = copy_res.size_of_objects;

    const rule_status = {
        last_cycle_rule_id: rule,
        last_cycle_writes_num: num_keys_moved,
        last_cycle_writes_size: num_bytes_moved,
        last_cycle_error_writes_num: num_keys_to_copy - num_keys_moved,
        last_cycle_error_writes_size: num_bytes_to_copy - num_bytes_moved,
    };
    if (src_cont_token) rule_status.last_cycle_src_cont_token = src_cont_token;
    dbg.log1('get_rule_and_bucket_status:: rule_status: ', rule_status);

    const bucket_status = {
        bucket_last_cycle_total_objects_num: num_keys_to_copy,
        bucket_last_cycle_replicated_objects_num: num_keys_moved,
        bucket_last_cycle_error_objects_num: num_keys_to_copy - num_keys_moved,
    };
    dbg.log1('get_rule_and_bucket_status:: bucket_status: ', bucket_status);

    return {rule_status, bucket_status};
}

function update_replication_prom_report(bucket_name, replication_policy_id, rule_status, bucket_status) {
    const core_report = prom_reporting.get_core_report();
    const last_cycle_status = _.defaults({
        ...rule_status,
        ...bucket_status,
        bucket_name: bucket_name.unwrap(),
        replication_id: replication_policy_id
    }, PARTIAL_SINGLE_BUCKET_REPLICATION_DEFAULTS);

    core_report.set_replication_status(last_cycle_status);
}

function update_replication_target_status(source_bucket, target_bucket, is_reachable) {
    const core_report = prom_reporting.get_core_report();
    const src_name = source_bucket instanceof SensitiveString ? source_bucket.unwrap() : source_bucket;
    const dst_name = target_bucket instanceof SensitiveString ? target_bucket.unwrap() : target_bucket;
    core_report.set_replication_target_status(src_name, dst_name, is_reachable);
}

/**
 * @param {any} bucket_name
 * @param {string} key
 * @param {import('@aws-sdk/client-s3').S3} s3
 * @param {string} version_id
 */
async function get_object_md(bucket_name, key, s3, version_id) {
    if (bucket_name instanceof SensitiveString) bucket_name = bucket_name.unwrap();
    const params = {
        Bucket: bucket_name,
        Key: key,
        VersionId: version_id,
    };

    dbg.log1('get_object_md params:', params);
    try {
        const head = await s3.headObject(params);
        //for namespace s3 we are omitting the 'noobaa-namespace-s3-bucket' as it will be defer between buckets
        if (head?.Metadata) head.Metadata = _.omit(head.Metadata, 'noobaa-namespace-s3-bucket');
        dbg.log1('get_object_md: finished successfully', head);
        return head;
    } catch (err) {
        dbg.error('get_object_md: error.name: ', err?.name, ' error: ', err);
        if (err?.name === 'NotFound') return;
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

async function copy_objects(scanner_semaphore, client, copy_type, src_bucket_name, dst_bucket_name, keys_diff_map) {
    try {
        const keys_length = Object.keys(keys_diff_map);
        if (!keys_length.length) return;
        const res = await scanner_semaphore.surround_count(keys_length, //We will do key by key even when a key have more then one version
            async () => {
                try {
                    //calling copy_objects in the replication server
                    const res1 = await client.replication.copy_objects({
                        copy_type,
                        src_bucket_name,
                        dst_bucket_name,
                        keys_diff_map
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
                    dbg.error('replication_utils copy_objects: error: ', err, src_bucket_name, dst_bucket_name, keys_diff_map);
                }
            });
        return res;
    } catch (err) {
        dbg.error('replication_utils copy_objects: semaphore error:', err, err.stack);
        // no need to handle semaphore errors, eventually the object will be uploaded
    }
}

//TODO: probably need to handle it also, getting an objects and not keys array
//      as delete_objects is not being called in the replication scanner, we will handle it later.
async function delete_objects(scanner_semaphore, client, bucket_name, keys) {
    if (!keys.length) return;
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
exports.get_rule_and_bucket_status = get_rule_and_bucket_status;
exports.update_replication_prom_report = update_replication_prom_report;
exports.update_replication_target_status = update_replication_target_status;
exports.get_object_md = get_object_md;
exports.find_src_and_dst_buckets = find_src_and_dst_buckets;
exports.get_copy_type = get_copy_type;
exports.copy_objects = copy_objects;
exports.delete_objects = delete_objects;
