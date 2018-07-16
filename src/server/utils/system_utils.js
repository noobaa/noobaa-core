/* Copyright (C) 2016 NooBaa */
'use strict';

const size_utils = require('../../util/size_utils');
const os_utils = require('../../util/os_utils');
const system_store = require('../system_services/system_store').get_instance();
const MongoCtrl = require('./mongo_ctrl');

function system_in_maintenance(system_id) {
    const system = system_store.data.get_by_id(system_id);

    if (!system) {
        // we don't want to throw here because callers will handle system deletion
        // on their own paths, and not as exception from here which.
        return false;
    }

    if (system.maintenance_mode &&
        system.maintenance_mode > Date.now()) {
        return true;
    }

    return false;
}



// returns the percent of quota used by the bucket
function get_bucket_quota_usage_percent(bucket, bucket_quota) {
    if (!bucket_quota) return 0;

    const bucket_used = bucket.storage_stats && size_utils.json_to_bigint(bucket.storage_stats.objects_size);
    const quota = size_utils.json_to_bigint(bucket_quota.value);
    let used_percent = bucket_used.multiply(100).divide(quota);
    return used_percent.valueOf();
}

// Update mongo_wrapper on system created
// This will cause more tests to be run in mongo_wrapper
function mongo_wrapper_system_created() {
    if (os_utils.is_supervised_env()) {
        return MongoCtrl.init()
            .then(() => console.log('Skipping mongo_wrapper update')); /*MongoCtrl.update_wrapper_sys_check()*/
    }
}

function prepare_chunk_for_mapping(chunk) {
    chunk.chunk_coder_config = system_store.data.get_by_id(chunk.chunk_config).chunk_coder_config;
}

exports.system_in_maintenance = system_in_maintenance;
exports.get_bucket_quota_usage_percent = get_bucket_quota_usage_percent;
exports.mongo_wrapper_system_created = mongo_wrapper_system_created;
exports.prepare_chunk_for_mapping = prepare_chunk_for_mapping;
