/* Copyright (C) 2026 NooBaa */
"use strict";

const _ = require('lodash');
const SensitiveString = require('../../../util/sensitive_string');
const access_policy_utils = require('../../../util/access_policy_utils');
const schema_utils = require('../../../util/schema_utils');

/**
 * 5.21.0 wrote IAM ARNs as arn:aws:iam::<user _id>:user/<email>.
 * Email can contain ':', which parse_iam_arn_principal does not accept.
 * @param {string} arn
 * @returns {{account_id: string, is_root: boolean, iam_user_name?: string}|undefined}
 */
function parse_principal_arn(arn) {
    const parsed = access_policy_utils.parse_iam_arn_principal(arn);
    if (parsed) return parsed;
    const match = (/^arn:aws:iam::([^:]+):user\/(.+)$/).exec(arn);
    if (!match) return;
    // match[2] is "<iam path><user_name>". The path may contain '/', so the user name is the last segment.
    // example: arn:aws:iam::123456789012:user/test/iam_user -> match[2] = "test/iam_user", iam_user_name = "iam_user"
    const iam_user_name = match[2].split('/').pop();
    return { account_id: match[1], is_root: false, iam_user_name };
}

function find_account_by_id(system_store, account_id) {
    return system_store.data.accounts.find(account => account._id.toString() === account_id);
}

function account_name_matches(account, iam_user_name) {
    const email = access_policy_utils.aws_principal_to_string(account.email);
    const name = access_policy_utils.aws_principal_to_string(account.name);
    const wanted = iam_user_name.toLowerCase();
    return email.toLowerCase() === wanted || name.toLowerCase() === wanted;
}

/**
 * @param {string} arn
 * @param {import('../../../server/system_services/system_store').SystemStore} system_store
 * @returns {string|undefined}
 */
function resolve_arn_to_account_id(arn, system_store) {
    const parsed = parse_principal_arn(arn);
    if (!parsed) return;
    if (parsed.is_root) {
        const account = find_account_by_id(system_store, parsed.account_id);
        return account && account._id.toString();
    }
    const by_owner_email = system_store.get_account_by_email(
        new SensitiveString(`${parsed.iam_user_name.toLowerCase()}:${parsed.account_id}`)
    );
    if (by_owner_email) {
        // Username lookup ignores iam_path. Keep the id only when the stored ARN matches, path included.
        if (access_policy_utils.get_policy_principal_arn(by_owner_email) !== arn) return;
        return by_owner_email._id.toString();
    }
    // 5.21.0 arn:aws:iam::<iam user _id>:user/<email> — ARN account id is the user, not the owner.
    const by_id = find_account_by_id(system_store, parsed.account_id);
    // Keep the id when this account is an IAM user and its email or name equals the IAM user name.
    if (by_id && access_policy_utils.is_owned_identity(by_id) && account_name_matches(by_id, parsed.iam_user_name)) {
        return by_id._id.toString();
    }
}

/**
 * Map one stored principal to an account id.
 * Returns null when the account cannot be found so the caller can drop it.
 * @param {string|SensitiveString} principal
 * @param {import('../../../server/system_services/system_store').SystemStore} system_store
 * @param {{warn: function}} dbg
 * @returns {string|null}
 */
function resolve_stored_principal(principal, system_store, dbg) {
    const value = access_policy_utils.aws_principal_to_string(principal);
    if (value === '*') return '*';
    if (schema_utils.is_object_id_string(value)) {
        const account = find_account_by_id(system_store, value);
        if (account) return account._id.toString();
    }
    if (value.startsWith('arn:aws:iam::')) {
        const account_id = resolve_arn_to_account_id(value, system_store);
        if (account_id) return account_id;
    } else {
        const by_email = system_store.get_account_by_email(new SensitiveString(value));
        if (by_email) return by_email._id.toString();
    }
    dbg.warn(`upgrade_bucket_policy_principal: could not resolve principal ${value}, dropping`);
    return null;
}

/**
 * Rewrite Principal / NotPrincipal.AWS to account ids.
 * Returns value undefined when no principals remain.
 * @param {object|string|SensitiveString} principal
 * @param {import('../../../server/system_services/system_store').SystemStore} system_store
 * @param {{warn: function}} dbg
 * @returns {{ new_principal: object|string|undefined, changed: boolean }}
 */
function remap_principals(principal, system_store, dbg) {
    if (!principal || principal.AWS === undefined) {
        return { new_principal: principal, changed: false };
    }

    if (access_policy_utils.is_aws_principal_wildcard(principal)) {
        return {
            new_principal: '*',
            changed: false,
        };
    }
    const was_array = Array.isArray(principal.AWS);
    const current_principals = was_array ? principal.AWS : [principal.AWS];
    const mapped = current_principals
        .map(item => resolve_stored_principal(item, system_store, dbg))
        .filter(item => item !== null && item !== undefined);
    if (!mapped.length) return { new_principal: undefined, changed: true };
    // One remaining principal is stored as a string. The input may have been an array.
    const aws = { AWS: (mapped.length === 1 ? mapped[0] : mapped) };
    // Compare the original AWS values with the mapped values.
    const original_aws = was_array ?
        current_principals.map(item => access_policy_utils.aws_principal_to_string(item)) :
        access_policy_utils.aws_principal_to_string(current_principals[0]);
    return { new_principal: aws, changed: !_.isEqual(original_aws, aws.AWS) };
}

function upgrade_policy(policy, system_store, dbg) {
    const upgraded = _.cloneDeep(policy);
    const updated_statements = [];
    let changed = false;
    for (const statement of upgraded.Statement || []) {
        for (const key of ['Principal', 'NotPrincipal']) {
            if (!statement[key]) continue;
            const remapped = remap_principals(statement[key], system_store, dbg);
            if (remapped.new_principal === undefined) {
                delete statement[key];
                changed = true;
            } else {
                statement[key] = remapped.new_principal;
                changed = changed || remapped.changed;
            }
        }
        if (statement.Principal || statement.NotPrincipal) {
            updated_statements.push(statement);
        }
    }
    if (!updated_statements.length) return { policy: null, changed: true };
    if (updated_statements.length !== (policy.Statement || []).length) changed = true;
    upgraded.Statement = updated_statements;
    return { policy: upgraded, changed };
}

async function run({ dbg, system_store }) {
    try {
        dbg.log0('Starting bucket policy Principal id upgrade...');
        const buckets = [];
        for (const bucket of system_store.data.buckets) {
            if (!bucket.s3_policy || !bucket.s3_policy.Statement) continue;
            const { policy, changed } = upgrade_policy(bucket.s3_policy, system_store, dbg);
            if (!changed) continue;
            if (policy === null) {
                dbg.log0(`Bucket ${bucket._id} policy has no valid principals left, removing bucket policy`);
                buckets.push({
                    _id: bucket._id,
                    $unset: { s3_policy: 1 },
                });
            } else {
                buckets.push({
                    _id: bucket._id,
                    s3_policy: policy,
                });
            }
        }

        if (buckets.length > 0) {
            dbg.log0(`Replacing bucket policy Principal with account id for ${buckets.length} buckets.`);
            await system_store.make_changes({ update: { buckets } });
        } else {
            dbg.log0('Upgrading buckets policy Principal to account id: no upgrade needed...');
        }
    } catch (err) {
        dbg.error('Got error while upgrading buckets policy Principal to account id:', err);
        throw err;
    }
}

module.exports = {
    run,
    description: 'Update bucket policy Principal from ARN or email to account id',
};
