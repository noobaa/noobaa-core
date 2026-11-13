/* Copyright (C) 2026 NooBaa */
'use strict';

const util = require('util');
const _ = require('lodash');
const P = require('../../../util/promise');
const config = require('../../../../config');
const { ConfigFS } = require('../../../sdk/config_fs');
const native_fs_utils = require('../../../util/native_fs_utils');
const access_policy_utils = require('../../../util/access_policy_utils');
const schema_utils = require('../../../util/schema_utils');

const PRINCIPAL_KEYS = ['Principal', 'NotPrincipal'];

// Flow: run() -> upgrade_buckets_policy_principal() -> upgrade_bucket_policy_principal_config() per bucket.
// Legacy on-disk policies store Principal.AWS as ARN or account name; after upgrade they store identity _id (or '*').

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
 * bucket_policy_principals_need_upgrade is true when any AWS principal is not already '*' or a stored ObjectId.
 */
function bucket_policy_principals_need_upgrade(policy) {
    if (!policy?.Statement) return false;
    for (const statement of policy.Statement) {
        for (const principal_key of PRINCIPAL_KEYS) {
            for (const principal_str of collect_aws_principals(statement[principal_key])) {
                if (access_policy_utils.is_aws_principal_wildcard(principal_str)) continue;
                if (!schema_utils.is_object_id_string(principal_str)) return true;
            }
        }
    }
    return false;
}

/**
 * map_upgrade_principal resolves one principal for upgrade: keep '*' and ids; ARN/name -> _id via ConfigFS.
 * Unresolvable values are left unchanged (unlike strict PUT normalize).
 */
async function map_upgrade_principal(config_fs, principal, dbg) {
    const principal_str = access_policy_utils.aws_principal_to_string(principal);
    if (access_policy_utils.is_aws_principal_wildcard(principal_str)) return '*';
    if (schema_utils.is_object_id_string(principal_str)) return principal_str;
    const account_id = await config_fs.resolve_principal_to_account_id(principal);
    if (!account_id) {
        dbg.warn(`upgrade_bucket_policy_principal: could not resolve principal ${principal_str}, leaving unchanged`);
        return principal_str;
    }
    return account_id;
}

/**
 * normalize_bucket_policy_principals_for_upgrade rewrites Principal / NotPrincipal AWS fields on a policy copy.
 */
async function normalize_bucket_policy_principals_for_upgrade(policy, config_fs, dbg) {
    const normalized = _.cloneDeep(policy);
    for (const statement of normalized.Statement) {
        for (const principal_key of PRINCIPAL_KEYS) {
            if (!statement[principal_key]) continue;
            statement[principal_key] = await access_policy_utils.remap_statement_principal_aws(
                statement[principal_key],
                principal => map_upgrade_principal(config_fs, principal, dbg),
                { require_aws: false }
            );
        }
    }
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
        const { failed_buckets, skipped_buckets, updated_count } = await upgrade_buckets_policy_principal(config_fs, bucket_names, dbg);
        if (failed_buckets.length > 0) {
            throw new Error('NC upgrade process failed, failed_buckets array length is bigger than 0' + util.inspect(failed_buckets));
        }
        if (bucket_names.length === 0) {
            dbg.log0('Upgrading buckets policy Principal: no upgrade needed...');
        }

        dbg.log0(`Finished upgrading buckets policy Principal:
            number of failed buckets: ${failed_buckets.length}
            number of skipped buckets: ${skipped_buckets.length}
            number of updated buckets: ${updated_count}`);
        if(skipped_buckets.length > 0) {
            dbg.log0('Skipped buckets:', skipped_buckets);
        }
        if(failed_buckets.length > 0) {
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
    const skipped_buckets = [];
    let updated_count = 0;
    for (const bucket_name of bucket_names) {
        let retries = 3;
        while (retries > 0) {
            try {
                const { updated, skipped } = await upgrade_bucket_policy_principal_config(config_fs, bucket_name, dbg);
                if (!updated && skipped) {
                    skipped_buckets.push(bucket_name);
                } else if (updated && !skipped) {
                    updated_count++;
                }
                break;
            } catch (err) {
                retries -= 1;
                dbg.warn(`upgrade bucket policy Principal failed ${bucket_name}, err ${err} retries left ${retries}`);
                if (retries <= 0) {
                    failed_buckets.push({ bucket_name, err });
                    break;
                }
                await P.delay(20);
            }
        }
    }
    return {failed_buckets, skipped_buckets, updated_count};
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
        dbg.log0(`upgrade_bucket_policy_principal_config: bucket ${bucket_name} principals already stored as ids, skipping`);
        return { updated: false, skipped: true };
    }

    // Remap legacy principals; skip file write if nothing changed (e.g. all principals unresolvable).
    const new_policy = await normalize_bucket_policy_principals_for_upgrade(bucket.s3_policy, config_fs, dbg);
    if (_.isEqual(new_policy, bucket.s3_policy)) {
        dbg.log0(`upgrade_bucket_policy_principal_config: bucket ${bucket_name} policy unchanged after remap, skipping write`);
        return { updated: false, skipped: true };
    }

    bucket.s3_policy = new_policy;
    dbg.log0(`Rewriting bucket policy Principal to id format for: ${util.inspect(bucket.name)}`);
    const { string_bucket_data } = config_fs._prepare_for_bucket_schema(bucket);
    const bucket_config_path = config_fs.get_bucket_path_by_name(bucket_name);
    await native_fs_utils.update_config_file(config_fs.fs_context, config_fs.buckets_dir_path, bucket_config_path, string_bucket_data);
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
