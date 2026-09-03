/* Copyright (C) 2026 NooBaa */
'use strict';

const util = require('util');
const P = require('../../../util/promise');
const config = require('../../../../config');
const { ConfigFS } = require('../../../sdk/config_fs');
const native_fs_utils = require('../../../util/native_fs_utils');

/**
 * get_default_cors_configuration returns the default bucket CORS configuration
 * @returns {Object[]}
 */
function get_default_cors_configuration() {
    return [{
        allowed_origins: config.S3_CORS_ALLOW_ORIGIN,
        allowed_methods: config.S3_CORS_ALLOW_METHODS,
        allowed_headers: config.S3_CORS_ALLOW_HEADERS,
        expose_headers: config.S3_CORS_EXPOSE_HEADERS,
    }];
}

/**
 * run adds the default CORS configuration to all existing buckets that do not already have one.
 * Mirrors the containerized upgrade_scripts/5.19.0/upgrade_bucket_cors.js behavior for NC config-dir buckets.
 * @param {{dbg: *, from_version?: String, config_fs?: import('../../../sdk/config_fs').ConfigFS}} params
 */
async function run({ dbg, config_fs: config_fs_param }) {
    try {
        const config_fs = config_fs_param || new ConfigFS(config.NSFS_NC_CONF_DIR, config.NSFS_NC_CONFIG_DIR_BACKEND);
        dbg.log0('Starting bucket CORS upgrade...');

        const buckets_dir_exists = await config_fs.validate_config_dir_exists(config_fs.buckets_dir_path);
        if (!buckets_dir_exists) {
            dbg.log0('Upgrading buckets CORS configuration: buckets directory does not exist, no upgrade needed...');
            return;
        }

        const bucket_names = await config_fs.list_buckets();
        const failed_buckets = await upgrade_buckets_cors(config_fs, bucket_names, dbg);

        if (failed_buckets.length > 0) {
            throw new Error('NC upgrade process failed, failed_buckets array length is bigger than 0' + util.inspect(failed_buckets));
        }
        if (bucket_names.length === 0) {
            dbg.log0('Upgrading buckets CORS configuration: no upgrade needed...');
        }
    } catch (err) {
        dbg.error('Got error while upgrading buckets CORS configuration:', err);
        throw err;
    }
}

/**
 * upgrade_buckets_cors iterates all buckets and adds the default CORS configuration with retries
 * @param {import('../../../sdk/config_fs').ConfigFS} config_fs
 * @param {String[]} bucket_names
 * @param {*} dbg
 * @returns {Promise<Object[]>}
 */
async function upgrade_buckets_cors(config_fs, bucket_names, dbg) {
    const failed_buckets = [];
    for (const bucket_name of bucket_names) {
        let retries = 3;
        while (retries > 0) {
            try {
                await upgrade_bucket_cors_config(config_fs, bucket_name, dbg);
                break;
            } catch (err) {
                retries -= 1;
                dbg.warn(`upgrade bucket CORS failed ${bucket_name}, err ${err} retries left ${retries}`);
                if (retries <= 0) {
                    failed_buckets.push({ bucket_name, err });
                    break;
                }
                await P.delay(20);
            }
        }
    }
    return failed_buckets;
}

/**
 * upgrade_bucket_cors_config adds the default CORS configuration to a single bucket
 * if it does not already have cors_configuration_rules.
 * Writes via native_fs_utils so the update is allowed while the config directory is locked
 * during the upgrade.
 * @param {import('../../../sdk/config_fs').ConfigFS} config_fs
 * @param {String} bucket_name
 * @param {*} dbg
 * @returns {Promise<void>}
 */
async function upgrade_bucket_cors_config(config_fs, bucket_name, dbg) {
    const bucket = await config_fs.get_bucket_by_name(bucket_name, { silent_if_missing: true });
    if (!bucket) {
        dbg.warn(`upgrade_bucket_cors_config: bucket ${bucket_name} was not found, skipping`);
        return;
    }
    if (Array.isArray(bucket.cors_configuration_rules) && bucket.cors_configuration_rules.length > 0) {
        dbg.log0(`upgrade_bucket_cors_config: bucket ${bucket_name} already has CORS configuration, skipping`);
        return;
    }

    bucket.cors_configuration_rules = get_default_cors_configuration();
    dbg.log0(`Adding default bucket CORS configuration to: ${util.inspect(bucket.name)}`);
    const { string_bucket_data } = config_fs._prepare_for_bucket_schema(bucket);
    const bucket_config_path = config_fs.get_bucket_path_by_name(bucket_name);
    await native_fs_utils.update_config_file(config_fs.fs_context, config_fs.buckets_dir_path, bucket_config_path, string_bucket_data);
}

module.exports = {
    run,
    description: 'Update default CORS configuration for all buckets',
};

module.exports.get_default_cors_configuration = get_default_cors_configuration;
module.exports.upgrade_buckets_cors = upgrade_buckets_cors;
module.exports.upgrade_bucket_cors_config = upgrade_bucket_cors_config;
