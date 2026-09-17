/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const S3Error = require('./s3_errors').S3Error;
const s3_utils = require('./s3_utils');
const s3_bucket_policy_auth = require('./s3_bucket_policy_auth');
const access_policy_utils = require('../../util/access_policy_utils');
const iam_utils = require('../iam/iam_utils');

/**
 * Parsed header/flag → extra S3 action. Same shape as OP_NAME_TO_ACTION values:
 * action strings only. Header parsing stays in this S3 module, not access_policy_utils.
 */
const PARSED_HEADER_TO_EXTRA_ACTION = Object.freeze({
    bypass_governance: access_policy_utils.BYPASS_GOVERNANCE_RETENTION_ACTION,
    object_lock_legal_hold: access_policy_utils.OP_NAME_TO_ACTION.put_object_legal_hold.regular,
    object_lock_retention: access_policy_utils.OP_NAME_TO_ACTION.put_object_retention.regular,
});

/**
 * Extra S3 actions from headers/flags (Bypass, lock-on-upload).
 * Kept separate from authorize_request_policy: different action, ARNs
 * (DeleteObjects keys after body parse), and IAM extra-action Allow.
 * Bucket-policy / owner evaluation is the same helper as primary policy.
 * @param {nb.S3Request} req
 */
async function authorize_extra_s3_actions_if_requested(req) {
    if (!req.params.bucket) return;
    // DeleteObjects keys live in the XML body. Skip until s3_rest has parsed it.
    if (req.op_name === 'post_bucket_delete' && !req.body?.Delete) return;
    const primary = _get_method_from_req(req);
    for (const action of _extra_actions_from_req(req)) {
        if (_method_includes_action(primary, action)) continue;
        if (await _has_additional_s3_action_permission(req, action)) continue;
        dbg.error('authorize_extra_s3_actions_if_requested: AccessDenied for',
            action, req.op_name, req.params.bucket, req.params.key);
        throw new S3Error(S3Error.AccessDenied);
    }
}

/**
 * Parse Object Lock / Bypass headers, then map to action names.
 * @param {nb.S3Request} req
 * @returns {string[]}
 */
function _extra_actions_from_req(req) {
    const actions = [];
    if (s3_utils.is_bypass_governance_requested(req)) {
        actions.push(PARSED_HEADER_TO_EXTRA_ACTION.bypass_governance);
    }
    if (s3_utils.is_object_lock_legal_hold_requested(req)) {
        actions.push(PARSED_HEADER_TO_EXTRA_ACTION.object_lock_legal_hold);
    }
    if (s3_utils.is_object_lock_retention_requested(req)) {
        actions.push(PARSED_HEADER_TO_EXTRA_ACTION.object_lock_retention);
    }
    return actions;
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

    const account_identifier_name = s3_bucket_policy_auth.get_account_identifier_name(
        account, is_nc_deployment);
    // Same owner/system-owner rules as authorize_request_policy: owner is not
    // an implicit Allow over an explicit bucket-policy Deny.
    if (s3_bucket_policy_auth.is_system_owner(system_owner, account_identifier_name)) return true;
    const is_owner = s3_bucket_policy_auth.is_bucket_owner(account, req.params.bucket, {
        owner_account,
        bucket_owner,
        account_identifier_name,
    });
    if (!s3_policy) return is_owner || iam_allows;

    const policy_result = await s3_bucket_policy_auth.evaluate_bucket_policy_action({
        req,
        s3_policy,
        account,
        is_nc_deployment,
        account_identifier_name,
        action,
        arn_paths: _get_extra_action_resource_arns(req),
        public_access_block,
    });
    if (policy_result === 'DENY') return false;
    if (policy_result === 'ALLOW' || is_owner || iam_allows) return true;
    return false;
}

/**
 * DeleteObjects has no object key in the URL. After the XML body is parsed,
 * evaluate each requested object ARN so an object-level Deny matches.
 */
function _get_extra_action_resource_arns(req) {
    if (!req.params.bucket) return [];
    const bucket_arn = `arn:aws:s3:::${req.params.bucket}`;
    if (req.op_name === 'post_bucket_delete') {
        return _delete_object_keys_from_body(req).map(key => `${bucket_arn}/${key}`);
    }
    const arn_path = _get_arn_from_req_path(req);
    return arn_path ? [arn_path] : [];
}

function _delete_object_keys_from_body(req) {
    const raw = req.body?.Delete?.Object;
    if (!raw) return [];
    const objects = Array.isArray(raw) ? raw : [raw];
    const keys = [];
    for (const item of objects) {
        const key = item.Key?.[0];
        if (key) keys.push(key);
    }
    return keys;
}

function _method_includes_action(method, action) {
    if (Array.isArray(method)) return method.includes(action);
    return method === action;
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
exports._extra_actions_from_req = _extra_actions_from_req;
