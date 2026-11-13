/* Copyright (C) 2026 NooBaa */
'use strict';

const util = require('util');
const _ = require('lodash');
const P = require('../../../util/promise');
const config = require('../../../../config');
const { ConfigFS, CONFIG_TYPES } = require('../../../sdk/config_fs');
const native_fs_utils = require('../../../util/native_fs_utils');
const access_policy_utils = require('../../../util/access_policy_utils');
const schema_utils = require('../../../util/schema_utils');

const PRINCIPAL_KEYS = ['Principal', 'NotPrincipal'];

// Flow: run() -> upgrade_buckets_policy_principal() -> upgrade_bucket_policy_principal_config() per bucket.
// Legacy on-disk policies store Principal.AWS as ARN or account name; after upgrade they store identity _id (or '*').
// Unresolvable principals are dropped; when no statements remain the bucket policy is deleted.

/**
 * collect_aws_principals lists AWS principal strings from a statement Principal / NotPrincipal value.
 * Federated-only principals are ignored (not migrated by this script).
 */
function collect_aws_principals(statement_principal) {
    if (!statement_principal) return [];
    if (statement_principal.AWS !== undefined) {
        return _.flatten([statement_principal.AWS]).map(access_policy_utils.aws_principal_to_string);
    }
    if (typeof statement_principal !== 'object' || Array.isArray(statement_principal)) {
        return [access_policy_utils.aws_principal_to_string(statement_principal)];
    }
    return [];
}

/**
 * bucket_policy_principals_need_upgrade is true when any AWS principal is not '*'.
 * Do not treat 24-hex strings as migrated ids (account names can match ObjectId shape).
 */
function bucket_policy_principals_need_upgrade(policy) {
    if (!policy?.Statement) return false;
    for (const statement of policy.Statement) {
        for (const principal_key of PRINCIPAL_KEYS) {
            for (const principal_str of collect_aws_principals(statement[principal_key])) {
                if (access_policy_utils.is_aws_principal_wildcard(principal_str)) continue;
                return true;
            }
        }
    }
    return false;
}

/**
 * map_upgrade_principal resolves one principal for upgrade: keep '*' and ids; ARN/name -> _id via ConfigFS.
 * Returns null for unresolved principals (dropped from the policy).
 */
async function map_upgrade_principal(config_fs, principal, dbg) {
    const principal_str = access_policy_utils.aws_principal_to_string(principal);
    if (access_policy_utils.is_aws_principal_wildcard(principal_str)) return '*';
    if (schema_utils.is_object_id_string(principal_str)) {
        const identity = await config_fs.get_identity_by_id(
            principal_str, CONFIG_TYPES.ACCOUNT, { silent_if_missing: true });
        if (identity) return principal_str;
    }
    const account_id = await config_fs.resolve_principal_to_account_id(principal);
    if (!account_id) {
        dbg.warn(`upgrade_bucket_policy_principal: could not resolve principal ${principal_str}, dropping`);
        return null;
    }
    return account_id;
}

/**
 * normalize_bucket_policy_principals_for_upgrade rewrites Principal / NotPrincipal AWS fields on a policy copy.
 * @returns {Promise<object|null>} null removes the entire bucket policy when no statements remain.
 */
async function normalize_bucket_policy_principals_for_upgrade(policy, config_fs, dbg) {
    const normalized = _.cloneDeep(policy);
    const valid_principals = [];
    for (const statement of normalized.Statement) {
        for (const principal_key of PRINCIPAL_KEYS) {
            if (!statement[principal_key]) continue;
            const original = statement[principal_key];
            statement[principal_key] = await access_policy_utils.remap_statement_principal_aws(
                original,
                principal => map_upgrade_principal(config_fs, principal, dbg),
                { require_aws: false }
            );
            if (statement[principal_key]?.AWS !== undefined) {
                const was_array = Array.isArray(statement[principal_key].AWS);
                // Unresolvable principals are removed from the policy. 
                // If the statement has no valid principals left, the entire statement is removed.
                const aws = _.flatten([statement[principal_key].AWS])
                    .filter(v => v !== null && v !== undefined);
                if (aws.length) {
                    statement[principal_key] = { AWS: was_array ? aws : aws[0] };
                } else {
                    delete statement[principal_key];
                }
            }
        }
        if (statement.Principal || statement.NotPrincipal) valid_principals.push(statement);
    }
    // If no statements remain, return null so the bucket policy is removed.
    if (!valid_principals.length) return null;
    normalized.Statement = valid_principals;
    return normalized;
}

/**
 * run rewrites bucket policy principals from ARN / account name to stored identity ids for all buckets.
 * Mirrors containerized upgrade_scripts/5.21.0/upgrade_bucket_policy_principal.js (ARN conversion) for NC on-disk storage.
 * @param {{dbg: *, config_fs?: import('../../../sdk/config_fs').ConfigFS}} params
 */
async function run({ dbg, config_fs: config_fs_param }) {
    try {
        const config_fs = config_fs_param || new ConfigFS(config.NSFS_NC_CONF_DIR, config.NSFS_NC_CONFIG_DIR_BACKEND);
        dbg.log0('Starting bucket policy Principal upgrade...', config_fs);

        const buckets_dir_exists = await config_fs.validate_config_dir_exists(config_fs.buckets_dir_path);
        if (!buckets_dir_exists) {
            dbg.log0('Upgrading buckets policy Principal: buckets directory does not exist, no upgrade needed...');
            return;
        }
        const bucket_names = await config_fs.list_buckets();
        const { failed_buckets, updated_buckets_count } =
            await upgrade_buckets_policy_principal(config_fs, bucket_names, dbg);
        if (bucket_names.length === 0) {
            dbg.log0('Upgrading buckets policy Principal: no upgrade needed...');
        }

        dbg.log0(`Finished upgrading buckets policy Principal:
            number of failed buckets: ${failed_buckets.length}
            number of updated buckets: ${updated_buckets_count}`);
        if (failed_buckets.length > 0) {
            dbg.log0('Failed buckets:', failed_buckets);
        }
    } catch (err) {
        dbg.error('Got error while upgrading buckets policy Principal:', err);
        throw err;
    }
}

/**
 * upgrade_buckets_policy_principal upgrades each bucket; collects failures after retries for run() to report.
 */
async function upgrade_buckets_policy_principal(config_fs, bucket_names, dbg) {
    const failed_buckets = [];
    let updated_buckets_count = 0;
    for (const bucket_name of bucket_names) {
        let retries = 3;
        while (retries > 0) {
            try {
                const { updated, skipped } = await upgrade_bucket_policy_principal_config(config_fs, bucket_name, dbg);
                if (updated || skipped) updated_buckets_count += 1;
                break;
            } catch (err) {
                retries -= 1;
                dbg.warn(`upgrade bucket policy Principal failed ${bucket_name}, err ${err} retries left ${retries}`);
                if (retries <= 0) {
                    failed_buckets.push({ bucket_name, err: err.message || String(err) });
                    break;
                }
                await P.delay(20);
            }
        }
    }
    return { failed_buckets, updated_buckets_count };
}

/**
 * upgrade_bucket_policy_principal_config loads one bucket, remaps principals if needed, and writes buckets/<name>.json.
 * Uses native_fs_utils.update_config_file so updates are allowed while the config dir is locked during NC upgrade.
 */
async function upgrade_bucket_policy_principal_config(config_fs, bucket_name, dbg) {
    const bucket = await config_fs.get_bucket_by_name(bucket_name, { silent_if_missing: true });
    if (!bucket) {
        dbg.warn(`upgrade_bucket_policy_principal_config: bucket ${bucket_name} was not found, skipping`);
        return { updated: false, skipped: true };
    }
    if (!bucket.s3_policy?.Statement) {
        dbg.log0(`upgrade_bucket_policy_principal_config: bucket ${bucket_name} has no bucket policy, skipping`);
        return { updated: false, skipped: true };
    }
    if (!bucket_policy_principals_need_upgrade(bucket.s3_policy)) {
        dbg.log0(`upgrade_bucket_policy_principal_config: bucket ${bucket_name} has wildcard AWS principals only, skipping`);
        return { updated: false, skipped: true };
    }

    const new_policy = await normalize_bucket_policy_principals_for_upgrade(bucket.s3_policy, config_fs, dbg);
    if (new_policy === null) {
        dbg.log0(`upgrade_bucket_policy_principal_config: bucket ${bucket_name} policy has no valid principals left, removing bucket policy`);
        delete bucket.s3_policy;
    } else if (_.isEqual(new_policy, bucket.s3_policy)) {
        dbg.log0(`upgrade_bucket_policy_principal_config: bucket ${bucket_name} policy unchanged after remap, skipping write`);
        return { updated: false, skipped: true };
    } else {
        bucket.s3_policy = new_policy;
    }
    dbg.log0(`Rewriting bucket policy Principal to id format for: ${util.inspect(bucket.name)}`);
    const { string_bucket_data } = config_fs._prepare_for_bucket_schema(bucket);
    const bucket_config_path = config_fs.get_bucket_path_by_name(bucket_name);
    const previous_bucket_json = await native_fs_utils.read_file(config_fs.fs_context, bucket_config_path);
    try {
        await native_fs_utils.update_config_file(
            config_fs.fs_context, config_fs.buckets_dir_path, bucket_config_path, string_bucket_data);
    } catch (write_err) {
        dbg.warn(`upgrade_bucket_policy_principal_config: write failed for ${bucket_name}, restoring previous config`, write_err);
        try {
            await native_fs_utils.update_config_file(
                config_fs.fs_context, config_fs.buckets_dir_path, bucket_config_path, previous_bucket_json);
        } catch (restore_err) {
            dbg.error(`upgrade_bucket_policy_principal_config: restore failed for ${bucket_name}`, restore_err);
        }
        // Rethrow so this bucket is counted in failed_buckets; upgrade_buckets_policy_principal continues with the rest.
        throw write_err;
    }
    return { updated: true, skipped: false };
}

module.exports = {
    run,
    description: 'Update bucket policy Principal to stored account id format',
    bucket_policy_principals_need_upgrade,
    normalize_bucket_policy_principals_for_upgrade,
    upgrade_buckets_policy_principal,
    upgrade_bucket_policy_principal_config,
};
