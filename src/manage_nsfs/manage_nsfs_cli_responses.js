/* Copyright (C) 2016 NooBaa */
'use strict';

const config = require('../../config');

const NoobaaEvent = require('../manage_nsfs/manage_nsfs_events_utils').NoobaaEvent;

// TODO : define list & status types
/**
 * @typedef {{
 *      code?: string, 
 *      message?: string,
 *      http_code: number,
 *      list?: object,
 *      status?: object
 * }} ManageCLIResponseSpec
 */

class ManageCLIResponse {

    /**
     * @param {ManageCLIResponseSpec} response_spec 
     */
    constructor({ code, status, list, message }) {
        this.code = code;
        this.http_code = 200;
        this.status = status;
        this.list = list;
        this.message = message;
    }

    to_string(detail) {
        const json = {
            response: {
                code: this.code,
                message: detail?.name ? `${this.message}: ${detail.name}` : this.message,
            }
        };
        if (this.list || this.status) json.response.reply = typeof detail === 'string' ? JSON.parse(detail) : detail;
        return JSON.stringify(json, null, 2);
    }
}

// See Manage NSFS CLI error codes docs - TODO: add docs

///////////////////////////////
//////  DIAGNOSE RESPONSES ////
///////////////////////////////

ManageCLIResponse.HealthStatus = Object.freeze({
    code: 'HealthStatus',
    message: 'Health status retrieved successfully',
    status: {}
});

ManageCLIResponse.MetricsStatus = Object.freeze({
    code: 'MetricsStatus',
    message: 'Metrics status retrieved successfully',
    status: {}
});

///////////////////////////////
// IPS WHITE LIST RESPONSES ///
///////////////////////////////
ManageCLIResponse.WhiteListIPUpdated = Object.freeze({
    code: 'WhiteListIPUpdated',
    message: 'WhiteListIP has been updated successfully',
    status: {}
});

////////////////////////
// ACCOUNT RESPONSES ///
////////////////////////

ManageCLIResponse.AccountCreated = Object.freeze({
    code: 'AccountCreated',
    message: 'Account has been created successfully',
    status: {}
});

ManageCLIResponse.AccountDeleted = Object.freeze({
    code: 'AccountDeleted',
    message: 'Account has been deleted successfully'
});

ManageCLIResponse.AccountUpdated = Object.freeze({
    code: 'AccountUpdated',
    message: 'Account has been updated successfully',
    status: {}
});

ManageCLIResponse.AccountStatus = Object.freeze({
    code: 'AccountStatus',
    message: 'Account status retrieved successfully',
    status: {}
});

ManageCLIResponse.AccountList = Object.freeze({
    code: 'AccountList',
    message: 'Account list retrieved successfully',
    list: {}
});

////////////////////////
/// BUCKET RESPONSES ///
////////////////////////

ManageCLIResponse.BucketCreated = Object.freeze({
    code: 'BucketCreated',
    message: 'Bucket has been created successfully',
    status: {}
});

ManageCLIResponse.BucketDeleted = Object.freeze({
    code: 'BucketDeleted',
    message: 'Bucket has been deleted successfully'
});

ManageCLIResponse.BucketUpdated = Object.freeze({
    code: 'BucketUpdated',
    message: 'Bucket has been updated successfully',
    status: {}
});

ManageCLIResponse.BucketStatus = Object.freeze({
    code: 'BucketStatus',
    message: 'Bucket status retrieved successfully',
    status: {}
});

ManageCLIResponse.BucketList = Object.freeze({
    code: 'BucketList',
    message: 'Bucket list retrieved successfully',
    list: {}
});

///////////////////////////////
//     LOGGING RESPONSES     //
///////////////////////////////

ManageCLIResponse.LoggingExported = Object.freeze({
    code: 'LoggingExported',
    message: 'Logging data exported successfully',
    status: {}
});

///////////////////////////////
//     UPGRADE RESPONSES     //
///////////////////////////////

ManageCLIResponse.UpgradeSuccessful = Object.freeze({
    code: 'UpgradeSuccessful',
    message: 'Config directory upgrade completed successfully',
    status: {}
});

ManageCLIResponse.UpgradeStatus = Object.freeze({
    code: 'UpgradeStatus',
    message: 'Config directory upgrade status retrieved successfully',
    status: {}
});

ManageCLIResponse.UpgradeHistory = Object.freeze({
    code: 'UpgradeHistory',
    message: 'Config directory upgrade history retrieved successfully',
    status: {}
});

///////////////////////////////
//   CONNECTION RESPONSES    //
///////////////////////////////

ManageCLIResponse.ConnectionCreated = Object.freeze({
    code: 'ConnectionCreated',
    message: 'Notification connection has been created successfully',
    status: {}
});

ManageCLIResponse.ConnectionDeleted = Object.freeze({
    code: 'ConnectionDeleted',
    message: 'Notification connection has been deleted successfully'
});

ManageCLIResponse.ConnectionUpdated = Object.freeze({
    code: 'ConnectionUpdated',
    message: 'Notification connection has been updated successfully',
    status: {}
});

ManageCLIResponse.ConnectionStatus = Object.freeze({
    code: 'ConnectionStatus',
    message: 'Notification connection status retrieved successfully',
    status: {}
});

ManageCLIResponse.ConnectionList = Object.freeze({
    code: 'ConnectionList',
    message: 'Notification connection list retrieved successfully',
    list: {}
});

///////////////////////////////
//    LIFECYCLE RESPONSES    //
///////////////////////////////

ManageCLIResponse.LifecycleSuccessful = Object.freeze({
    code: 'LifecycleSuccessful',
    message: 'Lifecycle worker run finished successfully',
    status: {}
});

ManageCLIResponse.LifecycleWorkerNotRunning = Object.freeze({
    code: 'LifecycleWorkerNotRunning',
    message: `Lifecycle worker must run at ${config.NC_LIFECYCLE_RUN_TIME} ` +
        `with delay of ${config.NC_LIFECYCLE_RUN_DELAY_LIMIT_MINS} minutes ` +
        `in timezone ${config.NC_LIFECYCLE_TZ}`,
    status: {}
});

///////////////////////////////
//  RESPONSES-EVENT MAPPING  //
///////////////////////////////

const NSFS_CLI_SUCCESS_EVENT_MAP = {
    AccountCreated: NoobaaEvent.ACCOUNT_CREATED,
    AccountDeleted: NoobaaEvent.ACCOUNT_DELETED,
    BucketCreated: NoobaaEvent.BUCKET_CREATED,
    BucketDeleted: NoobaaEvent.BUCKET_DELETE,
    WhiteListIPUpdated: NoobaaEvent.WHITELIST_UPDATED,
    LoggingExported: NoobaaEvent.LOGGING_EXPORTED,
    UpgradeStarted: NoobaaEvent.CONFIG_DIR_UPGRADE_STARTED,
    UpgradeSuccessful: NoobaaEvent.CONFIG_DIR_UPGRADE_SUCCESSFUL,
    LifecycleSuccessful: NoobaaEvent.LIFECYCLE_SUCCESSFUL
};

exports.ManageCLIResponse = ManageCLIResponse;
exports.NSFS_CLI_SUCCESS_EVENT_MAP = NSFS_CLI_SUCCESS_EVENT_MAP;
