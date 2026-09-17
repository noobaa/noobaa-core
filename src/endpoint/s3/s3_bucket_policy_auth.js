/* Copyright (C) 2016 NooBaa */
'use strict';

const access_policy_utils = require('../../util/access_policy_utils');
const iam_utils = require('../iam/iam_utils');

/**
 * Shared bucket-policy evaluation for primary S3 ops and extra header actions.
 * Both paths call has_access_policy_permission the same way: principal
 * identifiers, then hosted IAM user also as the account root.
 * Returns DENY / ALLOW / IMPLICIT_DENY.
 */
async function evaluate_bucket_policy_action({
    req,
    s3_policy,
    account,
    is_nc_deployment,
    account_identifier_name,
    action,
    arn_paths,
    public_access_block,
}) {
    const policy_opts = { disallow_public_access: public_access_block?.restrict_public_buckets };
    const account_identifiers = get_account_identifiers(
        account, is_nc_deployment, account_identifier_name);
    const permission = await evaluate_policy_on_arns(
        s3_policy, account_identifiers, action, arn_paths, req, policy_opts);
    if (permission === 'DENY') return 'DENY';

    let permission_by_owner = 'IMPLICIT_DENY';
    // Hosted IAM user: also evaluate statements that grant the account root.
    // ARN check is not implemented in NC yet.
    if (!is_nc_deployment && account.owner !== undefined) {
        const owner_account_id = iam_utils.get_owner_account_id(account);
        const owner_account_identifier_arn = access_policy_utils.create_arn_for_root(owner_account_id);
        permission_by_owner = await evaluate_policy_on_arns(
            s3_policy,
            [owner_account_identifier_arn, owner_account_id],
            action,
            arn_paths,
            req,
            policy_opts,
        );
        if (permission_by_owner === 'DENY') return 'DENY';
    }
    if (permission === 'ALLOW' || permission_by_owner === 'ALLOW') return 'ALLOW';
    return 'IMPLICIT_DENY';
}

async function evaluate_policy_on_arns(
    s3_policy, account_identifiers, action, arn_paths, req, policy_opts) {
    let allowed = false;
    for (const arn_path of arn_paths) {
        const permission = await access_policy_utils.has_access_policy_permission(
            s3_policy, account_identifiers, action, arn_path, req, policy_opts);
        if (permission === 'DENY') return 'DENY';
        if (permission === 'ALLOW') allowed = true;
    }
    return allowed ? 'ALLOW' : 'IMPLICIT_DENY';
}

function get_account_identifier_name(account, is_nc_deployment) {
    return is_nc_deployment ? account.name.unwrap() : account.email.unwrap();
}

function is_system_owner(system_owner, account_identifier_name) {
    return Boolean(system_owner) && system_owner.unwrap() === account_identifier_name;
}

/**
 * Containerized: bucket_claim_owner / owner id.
 * NC: owner id, then name for backward compatibility.
 */
function is_bucket_owner(account, bucket_name, {
    owner_account, bucket_owner, account_identifier_name,
}) {
    if (account.bucket_claim_owner && account.bucket_claim_owner.unwrap() === bucket_name) return true;
    if (owner_account && owner_account.id === account._id) return true;
    if (account.owner === undefined && Boolean(bucket_owner) &&
        account_identifier_name === bucket_owner.unwrap()) return true;
    return false;
}

/**
 * NC: [ID, Name]. Containerized: [ID, ARN].
 */
function get_account_identifiers(account, is_nc_deployment, account_identifier_name) {
    const account_identifier_id = access_policy_utils.get_account_identifier_id(is_nc_deployment, account);
    const account_identifier_arn = access_policy_utils.get_policy_principal_arn(account);
    const account_identifiers = [];
    if (account_identifier_id) account_identifiers.push(account_identifier_id);
    if (is_nc_deployment && account.owner === undefined) account_identifiers.push(account_identifier_name);
    if (!is_nc_deployment) account_identifiers.push(account_identifier_arn);
    return account_identifiers;
}

exports.evaluate_bucket_policy_action = evaluate_bucket_policy_action;
exports.get_account_identifier_name = get_account_identifier_name;
exports.is_system_owner = is_system_owner;
exports.is_bucket_owner = is_bucket_owner;
exports.get_account_identifiers = get_account_identifiers;
