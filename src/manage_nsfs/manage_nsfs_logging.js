/* Copyright (C) 2024 NooBaa */
'use strict';

const config = require('../../config');
const { throw_cli_error, write_stdout_response} = require('../manage_nsfs/manage_nsfs_cli_utils');
const nc_mkm = require('../manage_nsfs/nc_master_key_manager').get_instance();
const ManageCLIError = require('../manage_nsfs/manage_nsfs_cli_errors').ManageCLIError;
const ManageCLIResponse = require('../manage_nsfs/manage_nsfs_cli_responses').ManageCLIResponse;
const { export_logs_to_target } = require('../util/bucket_logs_utils');
const http_utils = require('../util/http_utils');
const AWS = require('aws-sdk');

// This command goes over the logs in the persistent log and move the entries to log objects in the target buckets 
async function export_bucket_logging(config_fs) {
    const endpoint = `https://127.0.0.1:${config.ENDPOINT_SSL_PORT}`;
    const noobaa_con = new AWS.S3({
        endpoint,
        s3ForcePathStyle: true,
        sslEnabled: false,
        httpOptions: {
            agent: http_utils.get_unsecured_agent(endpoint)
        }
    });
    const success = await export_logs_to_target(config_fs, noobaa_con, get_bucket_owner_keys);
    if (success) {
        write_stdout_response(ManageCLIResponse.LoggingExported);
    } else {
        throw_cli_error(ManageCLIError.LoggingExportFailed);
    }
}

/**
 * return bucket owner's access and secret key
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @param {string} log_bucket_name
 * @returns {Promise<Object>} 
 */
async function get_bucket_owner_keys(config_fs, log_bucket_name) {
    const log_bucket_config_data = await config_fs.get_bucket_by_name(log_bucket_name);
    const log_bucket_owner = log_bucket_config_data.bucket_owner;
    const owner_config_data = await config_fs.get_account_by_name(log_bucket_owner, { show_secrets: true, decrypt_secret_key: true });
    return nc_mkm.decrypt_access_keys(owner_config_data);
}

exports.export_bucket_logging = export_bucket_logging;
