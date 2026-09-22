/* Copyright (C) 2026 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);
const config = require('../../config');
const pkg = require('../../package.json');
const ManageCLIError = require('./manage_nsfs_cli_errors').ManageCLIError;
const { ManageCLIResponse } = require('./manage_nsfs_cli_responses');
const { throw_cli_error, write_stdout_response } = require('./manage_nsfs_cli_utils');

/**
 * get_usage_stats gathers aggregate NC usage statistics from ConfigFS and prints them.
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @returns {Promise<void>}
 */
async function get_usage_stats(config_fs) {
    try {
        const usage_stats = await collect_usage_stats(config_fs);
        write_stdout_response(ManageCLIResponse.UsageStats, usage_stats);
    } catch (err) {
        dbg.warn('could not collect usage stats', err);
        throw_cli_error({ ...ManageCLIError.UsageStatsFailed, cause: err });
    }
}

/**
 * collect_usage_stats scans ConfigFS and returns aggregate usage statistics.
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @returns {Promise<object>}
 */
async function collect_usage_stats(config_fs) {
    const system_data = await config_fs.get_system_config_file({ silent_if_missing: true });
    const hosts_data = system_data ? config_fs.get_hosts_data(system_data) : {};

    const [identity_stats, buckets, connections] = await Promise.all([
        collect_identity_stats(config_fs),
        collect_buckets_stats(config_fs),
        collect_connections_stats(config_fs),
    ]);

    return {
        collected_at: new Date().toISOString(),
        noobaa_version: pkg.version,
        config_dir_version: system_data?.config_directory?.config_dir_version || config_fs.config_dir_version,
        hosts_count: Object.keys(hosts_data).length,
        accounts: identity_stats.accounts,
        users: identity_stats.users,
        buckets,
        connections,
    };
}

/**
 * collect_identity_stats returns aggregate account and IAM user statistics.
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @returns {Promise<{accounts: object, users: object}>}
 */
async function collect_identity_stats(config_fs) {
    const accounts = {
        total: 0,
        anonymous: 0,
        root_account_managers: 0,
        with_allow_bucket_creation: 0,
        with_default_connection: 0,
        with_users: 0,
    };
    const users = {
        total: 0,
    };

    const account_names = await config_fs.list_accounts();
    for (const account_name of account_names) {
        try {
            const account = await config_fs.get_account_by_name(account_name);
            accounts.total += 1;
            if (account.name === config.ANONYMOUS_ACCOUNT_NAME) {
                accounts.anonymous += 1;
                continue;
            }
            if (account.iam_operate_on_root_account) accounts.root_account_managers += 1;
            if (account.allow_bucket_creation) accounts.with_allow_bucket_creation += 1;
            if (account.default_connection) accounts.with_default_connection += 1;

            if (!account._id) continue;
            const usernames = await config_fs.list_users_under_account(account._id);
            if (usernames.length > 0) {
                users.total += usernames.length;
                accounts.with_users += 1;
            }
        } catch (err) {
            dbg.warn(`usage_stats: failed to read account ${account_name}`, err);
        }
    }
    return { accounts, users };
}

const TOP_RULES_COUNT = 10;

/**
 * collect_buckets_stats returns aggregate bucket and feature-usage statistics.
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @returns {Promise<object>}
 */
async function collect_buckets_stats(config_fs) {
    const features = {
        versioning_enabled: 0,
        versioning_suspended: 0,
        lifecycle: 0,
        notifications: 0,
        logging: 0,
        bucket_policy: 0,
        encryption: 0,
        website: 0,
        cors: 0,
        object_lock: 0,
        public_access_block: 0,
        tags: 0,
        force_md5_etag: 0,
    };
    const rule_counts = {
        lifecycle: [],
        notifications: [],
        cors: [],
        bucket_policy: [],
    };
    const stats = {
        total: 0,
        features,
    };

    const bucket_names = await config_fs.list_buckets();
    for (const bucket_name of bucket_names) {
        try {
            const bucket = await config_fs.get_bucket_by_name(bucket_name);
            stats.total += 1;
            count_bucket_features(bucket, features, rule_counts);
        } catch (err) {
            dbg.warn(`usage_stats: failed to read bucket ${bucket_name}`, err);
        }
    }

    features.lifecycle_top10_rules = top_counts(rule_counts.lifecycle, TOP_RULES_COUNT);
    features.notifications_top10_rules = top_counts(rule_counts.notifications, TOP_RULES_COUNT);
    features.cors_top10_rules = top_counts(rule_counts.cors, TOP_RULES_COUNT);
    features.bucket_policy_top10_statements = top_counts(rule_counts.bucket_policy, TOP_RULES_COUNT);
    return stats;
}

/**
 * count_bucket_features increments feature counters for a single bucket config
 * and records per-bucket rule/statement counts for top-N summaries.
 * @param {object} bucket
 * @param {object} features
 * @param {{lifecycle: number[], notifications: number[], cors: number[], bucket_policy: number[]}} rule_counts
 */
function count_bucket_features(bucket, features, rule_counts) {
    if (bucket.versioning === 'ENABLED') features.versioning_enabled += 1;
    if (bucket.versioning === 'SUSPENDED') features.versioning_suspended += 1;

    const lifecycle_rules_count = Array.isArray(bucket.lifecycle_configuration_rules) ?
        bucket.lifecycle_configuration_rules.length : 0;
    if (lifecycle_rules_count > 0) {
        features.lifecycle += 1;
        rule_counts.lifecycle.push(lifecycle_rules_count);
    }

    const notifications_count = Array.isArray(bucket.notifications) ? bucket.notifications.length : 0;
    if (notifications_count > 0) {
        features.notifications += 1;
        rule_counts.notifications.push(notifications_count);
    }

    if (bucket.logging) features.logging += 1;

    const bucket_policy_statements_count = Array.isArray(bucket.s3_policy?.Statement) ?
        bucket.s3_policy.Statement.length : 0;
    if (bucket.s3_policy) {
        features.bucket_policy += 1;
        if (bucket_policy_statements_count > 0) {
            rule_counts.bucket_policy.push(bucket_policy_statements_count);
        }
    }

    if (bucket.encryption) features.encryption += 1;
    if (bucket.website) features.website += 1;

    const cors_rules_count = Array.isArray(bucket.cors_configuration_rules) ?
        bucket.cors_configuration_rules.length : 0;
    if (cors_rules_count > 0) {
        features.cors += 1;
        rule_counts.cors.push(cors_rules_count);
    }

    if (bucket.object_lock_configuration?.object_lock_enabled === 'Enabled') {
        features.object_lock += 1;
    }
    if (bucket.public_access_block) features.public_access_block += 1;
    if (Array.isArray(bucket.tag) && bucket.tag.length > 0) features.tags += 1;
    if (bucket.force_md5_etag === true) features.force_md5_etag += 1;
}

/**
 * top_counts returns the highest counts in descending order, capped at limit.
 * @param {number[]} counts
 * @param {number} limit
 * @returns {number[]}
 */
function top_counts(counts, limit) {
    return counts
        .sort((a, b) => b - a)
        .slice(0, limit);
}

/**
 * collect_connections_stats returns aggregate connection statistics.
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @returns {Promise<object>}
 */
async function collect_connections_stats(config_fs) {
    const stats = {
        total: 0,
        by_protocol: {},
    };

    const connection_names = await config_fs.list_connections();
    for (const connection_name of connection_names) {
        try {
            const connection = await config_fs.get_connection_by_name(connection_name);
            stats.total += 1;
            const protocol = connection.notification_protocol || 'unknown';
            stats.by_protocol[protocol] = (stats.by_protocol[protocol] || 0) + 1;
        } catch (err) {
            dbg.warn(`usage_stats: failed to read connection ${connection_name}`, err);
        }
    }
    return stats;
}

exports.get_usage_stats = get_usage_stats;
exports.collect_usage_stats = collect_usage_stats;
