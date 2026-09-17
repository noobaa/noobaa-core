/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const S3Error = require('./s3_errors').S3Error;
const access_policy_utils = require('../../util/access_policy_utils');
const iam_utils = require('../iam/iam_utils');

/**
 * Extra S3 actions from headers/flags (Bypass, lock-on-upload).
 * No header → no extra check. Admin/bucket owner implicit Allow.
 * IAM users and assumed-role sessions need IAM or bucket-policy Allow.
 * @param {nb.S3Request} req
 */
async function authorize_extra_s3_actions_if_requested(req) {
    if (!req.params.bucket) return;
    const primary = _get_method_from_req(req);
    for (const trigger of access_policy_utils.EXTRA_S3_ACTION_TRIGGERS) {
        if (!trigger.is_requested(req)) continue;
        if (_method_includes_action(primary, trigger.action)) continue;
        if (await _has_additional_s3_action_permission(req, trigger.action)) continue;
        dbg.error('authorize_extra_s3_actions_if_requested: AccessDenied for',
            trigger.action, req.op_name, req.params.bucket, req.params.key);
        throw new S3Error(S3Error.AccessDenied);
    }
}

/**
 * @param {nb.S3Request} req
 * @param {string} action
 * @returns {Promise<boolean>}
 */
async function _has_additional_s3_action_permission(req, action) {
    const account = req.object_sdk.requesting_account;
    if (!account) return false;

    const is_nc_deployment = Boolean(req.object_sdk.nsfs_config_root);
    const iam_result = await iam_utils.authorize_request_iam_policy_impl(
        req, action, req.params.bucket, 's3');
    if (iam_result?.explicit_deny) return false;
    const iam_allows = iam_result === true;

    const {
        s3_policy,
        system_owner,
        bucket_owner,
        owner_account,
        public_access_block,
    } = await req.object_sdk.read_bucket_sdk_policy_info(req.params.bucket);

    const account_identifier_name = is_nc_deployment ?
        account.name.unwrap() : account.email.unwrap();
    if (Boolean(system_owner) && system_owner.unwrap() === account_identifier_name) return true;
    if (_is_bucket_owner(account, req.params.bucket, {
        owner_account,
        bucket_owner,
        account_identifier_name,
    })) return true;
    if (!s3_policy) return iam_allows;

    const arn_paths = _get_extra_action_resource_arns(req);
    const account_identifiers = _get_account_identifiers(
        account, is_nc_deployment, account_identifier_name);
    const policy_opts = { disallow_public_access: public_access_block?.restrict_public_buckets };
    const bucket_permission = await _evaluate_bucket_policy(
        s3_policy, account_identifiers, action, arn_paths, req, policy_opts);
    if (bucket_permission === 'DENY') return false;
    if (bucket_permission === 'ALLOW' || iam_allows) return true;

    if (is_nc_deployment || account.owner === undefined) return false;
    const owner_account_id = iam_utils.get_owner_account_id(account);
    const owner_account_identifier_arn = access_policy_utils.create_arn_for_root(owner_account_id);
    const permission_by_owner = await _evaluate_bucket_policy(
        s3_policy, [owner_account_identifier_arn, owner_account_id], action, arn_paths, req, policy_opts);
    return permission_by_owner === 'ALLOW';
}

/**
 * DeleteObjects has no object key in the URL and authorize runs before the body is
 * parsed, so evaluate extra actions against both the bucket ARN and the object wildcard.
 */
function _get_extra_action_resource_arns(req) {
    if (!req.params.bucket) return [];
    const bucket_arn = `arn:aws:s3:::${req.params.bucket}`;
    if (req.op_name === 'post_bucket_delete') {
        return [bucket_arn, `${bucket_arn}/*`];
    }
    const arn_path = _get_arn_from_req_path(req);
    return arn_path ? [arn_path] : [];
}

async function _evaluate_bucket_policy(
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

function _method_includes_action(method, action) {
    if (Array.isArray(method)) return method.includes(action);
    return method === action;
}

function _is_bucket_owner(account, bucket_name, {
    owner_account, bucket_owner, account_identifier_name,
}) {
    if (account.bucket_claim_owner && account.bucket_claim_owner.unwrap() === bucket_name) return true;
    if (owner_account && owner_account.id === account._id) return true;
    if (account.owner === undefined && Boolean(bucket_owner) &&
        account_identifier_name === bucket_owner.unwrap()) return true;
    return false;
}

function _get_account_identifiers(account, is_nc_deployment, account_identifier_name) {
    const account_identifier_id = access_policy_utils.get_account_identifier_id(is_nc_deployment, account);
    const account_identifier_arn = access_policy_utils.get_policy_principal_arn(account);
    const account_identifiers = [];
    if (account_identifier_id) account_identifiers.push(account_identifier_id);
    if (is_nc_deployment && account.owner === undefined) account_identifiers.push(account_identifier_name);
    if (!is_nc_deployment) account_identifiers.push(account_identifier_arn);
    return account_identifiers;
}

function _get_method_from_req(req) {
    const s3_op = access_policy_utils.OP_NAME_TO_ACTION[req.op_name];
    if (!s3_op) {
        dbg.error(`Got a not supported S3 op ${req.op_name} - doesn't suppose to happen`);
        throw new S3Error(S3Error.InternalError);
    }
    if (req.query && req.query.versionId && s3_op.versioned) {
        return s3_op.versioned;
    }
    return s3_op.regular;
}

function _get_arn_from_req_path(req) {
    if (!req.params.bucket) return;
    const bucket = req.params.bucket;
    const key = req.params.key;
    let arn_path = `arn:aws:s3:::${bucket}`;
    if (key) {
        arn_path += `/${key}`;
    }
    return arn_path;
}

exports.authorize_extra_s3_actions_if_requested = authorize_extra_s3_actions_if_requested;
exports._has_additional_s3_action_permission = _has_additional_s3_action_permission;
exports._get_extra_action_resource_arns = _get_extra_action_resource_arns;
