/* Copyright (C) 2024 NooBaa */
'use strict';

const { S3 } = require('@aws-sdk/client-s3');
const noobaa_s3_client = require('../sdk/noobaa_s3_client/noobaa_s3_client');
const config = require('../../config');
const { account_id_cache } = require('../sdk/accountspace_fs');
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
    const success = await export_logs_to_target(config_fs.fs_context, noobaa_con_func, get_bucket_owner_keys);
    if (success) {
        write_stdout_response(ManageCLIResponse.LoggingExported);
    } else {
        throw_cli_error(ManageCLIError.LoggingExportFailed);
    }
}

/**
 * A CB for bucket_logs_utils to get a v3 S3 connection.
 * @param {Object} credentials for the target bucket
 * @returns {S3} An S3 connection
 */

function noobaa_con_func(credentials) {
    const endpoint = `https://127.0.0.1:${config.ENDPOINT_SSL_PORT}`;

    return new S3({
            endpoint,
            forcePathStyle: true,
            tls: false,
            region: config.DEFAULT_REGION,
            requestHandler: noobaa_s3_client.get_requestHandler_with_suitable_agent(endpoint),
            credentials: {
                accessKeyId: credentials[0].access_key,
                secretAccessKey: credentials[0].secret_key
            }
    });
}

/**
 * return bucket owner's access and secret key
 * @param {string} log_bucket_name
 * @returns {Promise<Object>} 
 */
async function get_bucket_owner_keys(log_bucket_name) {
    const log_bucket_config_data = await config_fs.get_bucket_by_name(log_bucket_name);
    const log_bucket_owner_id = log_bucket_config_data.owner_account;
    try {
        const owner_config_data = await account_id_cache.get_with_cache({ _id: log_bucket_owner_id, config_fs });
        return owner_config_data.access_keys;
    } catch (err) {
        throw_cli_error(ManageCLIError.BucketSetForbiddenBucketOwnerNotExists,
            `could not find log bucket owner by id ${log_bucket_owner_id}, can not extract owner access keys`,
            { owner_account: log_bucket_owner_id });
    }
}

exports.export_bucket_logging = export_bucket_logging;
