/* Copyright (C) 2024 NooBaa */
'use strict';

const path = require('path');
const config = require('../../config');
const { throw_cli_error, get_config_file_path, get_config_data, write_stdout_response} = require('../manage_nsfs/manage_nsfs_cli_utils');
const nc_mkm = require('../manage_nsfs/nc_master_key_manager').get_instance();
const ManageCLIError = require('../manage_nsfs/manage_nsfs_cli_errors').ManageCLIError;
const ManageCLIResponse = require('../manage_nsfs/manage_nsfs_cli_responses').ManageCLIResponse;
const { export_logs_to_target } = require('../util/bucket_logs_utils');
const native_fs_utils = require('../util/native_fs_utils');
const http_utils = require('../util/http_utils');
const AWS = require('aws-sdk');
const { RpcError } = require('../rpc');

const buckets_dir_name = '/buckets';
const accounts_dir_name = '/accounts';
let config_root;
let config_root_backend;
let buckets_dir_path;
let accounts_dir_path;

// This command goes over the logs in the persistent log and move the entries to log objects in the target buckets 
async function export_bucket_logging(user_input) {
    const fs_context = native_fs_utils.get_process_fs_context();
    config_root_backend = user_input.config_root_backend || config.NSFS_NC_CONFIG_DIR_BACKEND;
    config_root = user_input.config_root || config.NSFS_NC_CONF_DIR;
    buckets_dir_path = path.join(config_root, buckets_dir_name);
    accounts_dir_path = path.join(config_root, accounts_dir_name);
    const endpoint = `https://127.0.0.1:${config.ENDPOINT_SSL_PORT}`;
    const noobaa_con = new AWS.S3({
        endpoint,
        s3ForcePathStyle: true,
        sslEnabled: false,
        httpOptions: {
            agent: http_utils.get_unsecured_agent(endpoint)
        }
    });
    const success = await export_logs_to_target(fs_context, noobaa_con, get_bucket_owner_keys);
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
    const log_bucket_path = get_config_file_path(buckets_dir_path, log_bucket_name);
    let log_bucket_owner;
    try {
        const log_bucket_config_data = await get_config_data(config_root_backend, log_bucket_path);
        log_bucket_owner = log_bucket_config_data.bucket_owner;
    } catch (err) {
        if (err.code === 'ENOENT') throw new RpcError('NO_SUCH_BUCKET', 'No such bucket: ' + log_bucket_name);
        throw err;
    }
    const owner_path = get_config_file_path(accounts_dir_path, log_bucket_owner);
    const owner_config_data = await get_config_data(config_root_backend, owner_path, true);
    return nc_mkm.decrypt_access_keys(owner_config_data);
}

exports.export_bucket_logging = export_bucket_logging;
