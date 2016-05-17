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
function resolve_cloud_sync_info(sync_policy) {
    var stat;
    if (!_.isEmpty(sync_policy)) {
        //If sync time is epoch (never synced) change to never synced
        if (sync_policy.paused) {
            stat = 'PAUSED';
        }
        if (!sync_policy.health) {
            stat = 'UNABLE';
        }
        if (sync_policy.status === 'IDLE') {
            stat = 'SYNCED';
        } else {
            stat = 'SYNCING';
        }
        if (sync_policy.last_sync === 0) {
            stat = 'UNSYNCED';
        }
    } else {
        stat = 'NOTSET';
    }
    return stat;
}
