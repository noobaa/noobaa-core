'use strict';

module.exports = {
    resolve_cloud_sync_info: resolve_cloud_sync_info,
};

var _ = require('lodash');

/**
 *
 * RESOLVE_CLOUD_SYNC_INFO
 *
 */
function resolve_cloud_sync_info(sync_policy, bucket) {
    if (!_.isEmpty(sync_policy)) {
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
            bucket.cloud_sync_status = 'UNSYNCED';
        }
    } else {
        bucket.cloud_sync_status = 'NOTSET';
    }
}
