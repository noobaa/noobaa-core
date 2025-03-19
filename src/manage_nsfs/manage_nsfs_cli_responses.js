/* Copyright (C) 2016 NooBaa */
'use strict';

const config = require('../../config');

const NoobaaEvent = require('../manage_nsfs/manage_nsfs_events_utils').NoobaaEvent;

// TODO : define list & status types
/**
 * @typedef {{
 *      code?: string, 
 *      http_code: number,
 *      list?: object,
 *      status?: object,  
 * }} ManageCLIResponseSpec
 */

class ManageCLIResponse {

    /**
     * @param {ManageCLIResponseSpec} response_spec 
     */
    constructor({ code, status, list }) {
        this.code = code;
        this.http_code = 200;
        this.status = status;
        this.list = list;
    }

    to_string(detail) {
        const json = {
            response: {
                code: this.code,
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
    status: {}
});

ManageCLIResponse.MetricsStatus = Object.freeze({
    code: 'MetricsStatus',
    status: {}
});

///////////////////////////////
// IPS WHITE LIST RESPONSES ///
///////////////////////////////
ManageCLIResponse.WhiteListIPUpdated = Object.freeze({
    code: 'WhiteListIPUpdated',
    status: {}
});

////////////////////////
// ACCOUNT RESPONSES ///
////////////////////////

ManageCLIResponse.AccountCreated = Object.freeze({
    code: 'AccountCreated',
    status: {}
});

ManageCLIResponse.AccountDeleted = Object.freeze({
    code: 'AccountDeleted',
});

ManageCLIResponse.AccountUpdated = Object.freeze({
    code: 'AccountUpdated',
    status: {}
});

ManageCLIResponse.AccountStatus = Object.freeze({
    code: 'AccountStatus',
    status: {}
});

ManageCLIResponse.AccountList = Object.freeze({
    code: 'AccountList',
    list: {}
});

////////////////////////
/// BUCKET RESPONSES ///
////////////////////////

ManageCLIResponse.BucketCreated = Object.freeze({
    code: 'BucketCreated',
    status: {}
});

ManageCLIResponse.BucketDeleted = Object.freeze({
    code: 'BucketDeleted',
});

ManageCLIResponse.BucketUpdated = Object.freeze({
    code: 'BucketUpdated',
    status: {}
});

ManageCLIResponse.BucketStatus = Object.freeze({
    code: 'BucketStatus',
    status: {}
});

ManageCLIResponse.BucketList = Object.freeze({
    code: 'BucketList',
    list: {}
});

///////////////////////////////
//     LOGGING RESPONSES     //
///////////////////////////////

ManageCLIResponse.LoggingExported = Object.freeze({
    code: 'LoggingExported',
    status: {}
});

///////////////////////////////
//     UPGRADE RESPONSES     //
///////////////////////////////

ManageCLIResponse.UpgradeSuccessful = Object.freeze({
    code: 'UpgradeSuccessful',
    status: {}
});

ManageCLIResponse.UpgradeStatus = Object.freeze({
    code: 'UpgradeStatus',
    status: {}
});

ManageCLIResponse.UpgradeHistory = Object.freeze({
    code: 'UpgradeHistory',
    status: {}
});

///////////////////////////////
//   CONNECTION RESPONSES    //
///////////////////////////////

ManageCLIResponse.ConnectionCreated = Object.freeze({
    code: 'ConnectionCreated',
    status: {}
});

ManageCLIResponse.ConnectionDeleted = Object.freeze({
    code: 'ConnectionDeleted',
});

ManageCLIResponse.ConnectionUpdated = Object.freeze({
    code: 'ConnectionUpdated',
    status: {}
});

ManageCLIResponse.ConnectionStatus = Object.freeze({
    code: 'ConnectionStatus',
    status: {}
});

ManageCLIResponse.ConnectionList = Object.freeze({
    code: 'ConnectionList',
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
