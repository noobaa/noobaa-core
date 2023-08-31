/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const dbg = require('../../util/debug_module')(__filename);
const s3_utils = require('./s3_utils');

const OP_NAME_TO_ACTION = Object.freeze({
    delete_bucket_analytics: { regular: "s3:PutAnalyticsConfiguration" },
    delete_bucket_cors: { regular: "s3:PutBucketCORS" },
    delete_bucket_encryption: { regular: "s3:PutEncryptionConfiguration" },
    delete_bucket_inventory: { regular: "s3:PutInventoryConfiguration" },
    delete_bucket_lifecycle: { regular: "s3:PutLifecycleConfiguration" },
    delete_bucket_metrics: { regular: "s3:PutMetricsConfiguration" },
    delete_bucket_policy: { regular: "s3:DeleteBucketPolicy" },
    delete_bucket_replication: { regular: "s3:PutReplicationConfiguration" },
    delete_bucket_tagging: { regular: "s3:PutBucketTagging" },
    delete_bucket_website: { regular: "s3:DeleteBucketWebsite" },
    delete_bucket: { regular: "s3:DeleteBucket" },
    delete_object_tagging: { regular: "s3:DeleteObjectTagging", versioned: "s3:DeleteObjectVersionTagging" },
    delete_object_uploadId: { regular: "s3:AbortMultipartUpload" },
    delete_object: { regular: "s3:DeleteObject", versioned: "s3:DeleteObjectVersion" },

    get_bucket_accelerate: { regular: "s3:GetAccelerateConfiguration" },
    get_bucket_acl: { regular: "s3:GetBucketAcl" },
    get_bucket_analytics: { regular: "s3:GetAnalyticsConfiguration" },
    get_bucket_cors: { regular: "s3:GetBucketCORS" },
    get_bucket_encryption: { regular: "s3:GetEncryptionConfiguration" },
    get_bucket_inventory: { regular: "s3:GetInventoryConfiguration" },
    get_bucket_lifecycle: { regular: "s3:GetLifecycleConfiguration" },
    get_bucket_location: { regular: "s3:GetBucketLocation" },
    get_bucket_logging: { regular: "s3:GetBucketLogging" },
    get_bucket_metrics: { regular: "s3:GetMetricsConfiguration" },
    get_bucket_notification: { regular: "s3:GetBucketNotification" },
    get_bucket_policy: { regular: "s3:GetBucketPolicy" },
    get_bucket_policy_status: { regular: "s3:GetBucketPolicyStatus" },
    get_bucket_replication: { regular: "s3:GetReplicationConfiguration" },
    get_bucket_requestpayment: { regular: "s3:GetBucketRequestPayment" },
    get_bucket_tagging: { regular: "s3:GetBucketTagging" },
    get_bucket_uploads: { regular: "s3:ListBucketMultipartUploads" },
    get_bucket_versioning: { regular: "s3:GetBucketVersioning" },
    get_bucket_versions: { regular: "s3:ListBucketVersions" },
    get_bucket_website: { regular: "s3:GetBucketWebsite" },
    get_bucket_object_lock: { regular: "s3:GetBucketObjectLockConfiguration" },
    get_bucket: { regular: "s3:ListBucket" },
    get_object_acl: { regular: "s3:GetObjectAcl" },
    get_object_tagging: { regular: "s3:GetObjectTagging", versioned: "s3:GetObjectVersionTagging" },
    get_object_uploadId: { regular: "s3:ListMultipartUploadParts" },
    get_object_retention: { regular: "s3:GetObjectRetention"},
    get_object_legal_hold: { regular: "s3:GetObjectLegalHold" },
    get_object: { regular: "s3:GetObject", versioned: "s3:GetObjectVersion" },
    get_service: { regular: "s3:ListAllMyBuckets" },

    head_bucket: { regular: "s3:ListBucket" },
    head_object: { regular: "s3:GetObject", versioned: "s3:GetObjectVersion" },

    post_bucket_delete: { regular: "s3:DeleteObject" },
    post_object: { regular: "s3:PutObject" },
    post_object_uploadId: { regular: "s3:PutObject" },
    post_object_uploads: { regular: "s3:PutObject" },
    post_object_select: { regular: "s3:GetObject" },

    put_bucket_accelerate: { regular: "s3:PutAccelerateConfiguration" },
    put_bucket_acl: { regular: "s3:PutBucketAcl" },
    put_bucket_analytics: { regular: "s3:PutAnalyticsConfiguration" },
    put_bucket_cors: { regular: "s3:PutBucketCORS" },
    put_bucket_encryption: { regular: "s3:PutEncryptionConfiguration" },
    put_bucket_inventory: { regular: "s3:PutInventoryConfiguration" },
    put_bucket_lifecycle: { regular: "s3:PutLifecycleConfiguration" },
    put_bucket_logging: { regular: "s3:PutBucketLogging" },
    put_bucket_metrics: { regular: "s3:PutMetricsConfiguration" },
    put_bucket_notification: { regular: "s3:PutBucketNotification" },
    put_bucket_policy: { regular: "s3:PutBucketPolicy" },
    put_bucket_replication: { regular: "s3:PutReplicationConfiguration" },
    put_bucket_requestpayment: { regular: "s3:PutBucketRequestPayment" },
    put_bucket_tagging: { regular: "s3:PutBucketTagging" },
    put_bucket_versioning: { regular: "s3:PutBucketVersioning" },
    put_bucket_website: { regular: "s3:PutBucketWebsite" },
    put_bucket_object_lock: { regular: "s3:PutBucketObjectLockConfiguration" },
    put_bucket: { regular: "s3:CreateBucket" },
    put_object_acl: { regular: "s3:PutObjectAcl" },
    put_object_tagging: { regular: "s3:PutObjectTagging", versioned: "s3:PutObjectVersionTagging" },
    put_object_uploadId: { regular: "s3:PutObject" },
    put_object_retention: { regular: "s3:PutObjectRetention" },
    put_object_legal_hold: { regular: "s3:GetObjectLegalHold"},
    put_object: { regular: "s3:PutObject" },
});

const qm_regex = /\?/g;
const ar_regex = /\*/g;

const predicate_map = {
    'StringEquals': (request_value, policy_value) => request_value === policy_value,
    'StringNotEquals': (request_value, policy_value) => request_value !== policy_value,
    'StringEqualsIgnoreCase': (request_value, policy_value) => request_value.toLowerCase() === policy_value.toLowerCase(),
    'StringNotEqualsIgnoreCase': (request_value, policy_value) => request_value.toLowerCase() !== policy_value.toLowerCase(),
    'StringLike': function(request_value, policy_value) {
        const value_regex = RegExp(`^${policy_value.replace(qm_regex, '.?').replace(ar_regex, '.*')}$`);
        return value_regex.test(request_value);
    },
    'StringNotLike': function(request_value, policy_value) {
        const value_regex = RegExp(`^${policy_value.replace(qm_regex, '.?').replace(ar_regex, '.*')}$`);
        return !value_regex.test(request_value);
    },
    'Null': function(request_value, policy_value) { return policy_value === 'true' ? request_value === null : request_value !== null; },
};

const condition_fit_functions = {
    's3:ExistingObjectTag': _is_object_tag_fit,
    's3:x-amz-server-side-encryption': _is_server_side_encryption_fit
};

const supported_actions = {
    's3:ExistingObjectTag': ['s3:DeleteObjectTagging', 's3:DeleteObjectVersionTagging', 's3:GetObject', 's3:GetObjectAcl', 's3:GetObjectTagging', 's3:GetObjectVersion', 's3:GetObjectVersionTagging', 's3:PutObjectAcl', 's3:PutObjectTagging', 's3:PutObjectVersionTagging'],
    's3:x-amz-server-side-encryption': ['s3:PutObject']
};

async function _is_server_side_encryption_fit(req, predicate, value) {
    const encryption = s3_utils.parse_encryption(req);
    const algorithm = encryption ? encryption.algorithm : null;
    const res = predicate(algorithm, value);
    dbg.log1('bucket_policy: encrytpion fit?', value, algorithm, res);
    return res;
}

async function _is_object_tag_fit(req, predicate, value) {
    const reply = await req.object_sdk.get_object_tagging(req.params);
    const tag = reply?.tagging?.find(element => (element.key === value.key));
    const tag_value = tag ? tag.value : null;
    const res = predicate(tag_value, value.value);
    dbg.log1('bucket_policy: object tag fit?', value, tag, res);
    return res;
}

async function has_bucket_policy_permission(policy, account, method, arn_path, req) {
    const [allow_statements, deny_statements] = _.partition(policy.Statement, statement => statement.Effect === 'Allow');

    // look for explicit denies
    if (await _is_statements_fit(deny_statements, account, method, arn_path, req)) return 'DENY';

    // look for explicit allows
    if (await _is_statements_fit(allow_statements, account, method, arn_path, req)) return 'ALLOW';

    // implicit deny
    return 'IMPLICIT_DENY';
}

async function _is_statements_fit(statements, account, method, arn_path, req) {
    for (const statement of statements) {
        let action_fit = false;
        let principal_fit = false;
        let resource_fit = false;
        let condition_fit = true;
        for (const action of _.flatten([statement.Action])) {
            dbg.log1('bucket_policy: action fit?', action, method);
            if ((action === '*') || (action === 's3:*') || (action === method)) {
                action_fit = true;
            }
        }
        const statement_principal = statement.Principal.AWS ? statement.Principal.AWS : statement.Principal;
        for (const principal of _.flatten([statement_principal])) {
            dbg.log1('bucket_policy: principal fit?', principal, account);
            if ((principal.unwrap() === '*') || (principal.unwrap() === account)) {
                principal_fit = true;
            }
        }
        for (const resource of _.flatten([statement.Resource])) {
            const resource_regex = RegExp(`^${resource.replace(qm_regex, '.?').replace(ar_regex, '.*')}$`);
            dbg.log1('bucket_policy: resource fit?', resource_regex, arn_path);
            if (resource_regex.test(arn_path)) {
                resource_fit = true;
            }
        }
        condition_fit = await _is_condition_fit(statement, req, method);

        dbg.log1('bucket_policy: is_statements_fit', action_fit, principal_fit, resource_fit, condition_fit);
        if (action_fit && principal_fit && resource_fit && condition_fit) return true;
    }
    return false;
}

async function _is_condition_fit(policy_statement, req, method) {
    if (!policy_statement.Condition || !req) {
        return true;
    }
    _parse_condition_keys(policy_statement.Condition);
    for (const [condition, condition_statements] of Object.entries(policy_statement.Condition)) {
        const predicate = predicate_map[condition];
        for (const [condition_key, value] of Object.entries(condition_statements)) {
            if (!supported_actions[condition_key].includes(method)) {
                continue;
            }
            if (await condition_fit_functions[condition_key](req, predicate, value) === false) {
                return false;
            }
        }
    }
    return true;
}

function _parse_condition_keys(condition_statement) {
    // condition key might include two parts: the condition itself and the key it uses.
    // for example s3:ExistingObjectTag/<key>: ExistingObjectTag is the condition, and <key> 
    // is the tag key it refers
    for (const condition of Object.values(condition_statement)) {
        for (const [condition_key, value] of Object.entries(condition)) {
            const key_parts = condition_key.split("/");
            if (key_parts[1]) {
                condition[key_parts[0]] = {key: key_parts[1], value: value};
                delete condition[condition_key];
            }
        }
    }
}


exports.OP_NAME_TO_ACTION = OP_NAME_TO_ACTION;
exports.SUPPORTED_BUCKET_POLICY_CONDITIONS = Object.keys(supported_actions);
exports.has_bucket_policy_permission = has_bucket_policy_permission;
