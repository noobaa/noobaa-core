/* Copyright (C) 2024 NooBaa */
'use strict';

const AWS = require('aws-sdk');
const config = require('../../config');
const http_utils = require('../util/http_utils');
const { CONFIG_TYPES } = require('../sdk/config_fs');
const { export_logs_to_target } = require('../util/bucket_logs_utils');
const ManageCLIError = require('../manage_nsfs/manage_nsfs_cli_errors').ManageCLIError;
const ManageCLIResponse = require('../manage_nsfs/manage_nsfs_cli_responses').ManageCLIResponse;
const { throw_cli_error, write_stdout_response} = require('../manage_nsfs/manage_nsfs_cli_utils');

let config_fs;
/** This command goes over the logs in the persistent log and move the entries to log objects in the target buckets 
/* @param {import('../sdk/config_fs').ConfigFS} shared_config_fs
*/
async function export_bucket_logging(shared_config_fs) {
    config_fs = shared_config_fs;
    const endpoint = `https://127.0.0.1:${config.ENDPOINT_SSL_PORT}`;
    const noobaa_con = new AWS.S3({
        endpoint,
        s3ForcePathStyle: true,
        sslEnabled: false,
        httpOptions: {
            agent: http_utils.get_unsecured_agent(endpoint)
        }
    });
    const success = await export_logs_to_target(config_fs.fs_context, noobaa_con, get_bucket_owner_keys);
    if (success) {
        write_stdout_response(ManageCLIResponse.LoggingExported);
    } else {
        throw_cli_error(ManageCLIError.LoggingExportFailed);
    }
}

/**
 * return bucket owner's access and secret key
 * @param {string} log_bucket_name
 * @returns {Promise<Object>} 
 */
async function get_bucket_owner_keys(log_bucket_name) {
    const log_bucket_config_data = await config_fs.get_bucket_by_name(log_bucket_name);
    const log_bucket_owner = log_bucket_config_data.owner_account;
    const owner_config_data = await config_fs.get_identity_by_id(log_bucket_owner,
        CONFIG_TYPES.ACCOUNT, { show_secrets: true, decrypt_secret_key: true });
    return owner_config_data.access_keys;
}

exports.export_bucket_logging = export_bucket_logging;
