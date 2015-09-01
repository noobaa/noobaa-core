/* jshint node:true */
'use strict';

var cloud_sync = require('./cloud_sync');

module.exports = {
    get_policy_status: cloud_sync.get_policy_status,
    refresh_policy: cloud_sync.refresh_policy,
};
