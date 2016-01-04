'use strict';

module.exports = {
    resolve_cloud_sync_info: resolve_cloud_sync_info,
};

var _ = require('lodash');
var moment = require('moment');

/**
 *
 * RESOLVE_CLOUD_SYNC_INFO
 *
 */
function resolve_cloud_sync_info(sync_policy, bucket) {
    if (!_.isEmpty(sync_policy)) {
        var interval_text = 0;
        if (sync_policy.policy.schedule < 60) {
            interval_text = sync_policy.policy.schedule + ' minutes';
        } else {
            if (sync_policy.policy.schedule < 60 * 24) {
                interval_text = sync_policy.policy.schedule / 60 + ' hours';
            } else {
                interval_text = sync_policy.policy.schedule / (60 * 24) + ' days';
            }
        }
        bucket.policy_schedule_in_min = interval_text;
        //If sync time is epoch (never synced) change to never synced
        if (sync_policy.paused) {
            bucket.cloud_sync_status = 'NOTSET';
        }
        if (!sync_policy.health) {
            bucket.cloud_sync_status = 'UNABLE';
        }
        if (sync_policy.status === 'IDLE') {
            bucket.cloud_sync_status = 'SYNCED';
        } else {
            bucket.cloud_sync_status = 'SYNCING';
        }
        if (sync_policy.policy.last_sync === 0) {
            bucket.last_sync = 'Waiting for first sync';
            bucket.cloud_sync_status = 'UNSYNCED';
        } else {
            bucket.last_sync = moment(sync_policy.policy.last_sync).format('LLL');
        }
    } else {
        bucket.cloud_sync_status = 'NOTSET';
    }
}
