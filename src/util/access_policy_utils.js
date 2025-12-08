/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const dbg = require('./debug_module')(__filename);
const s3_utils = require('../endpoint/s3/s3_utils');
const RpcError = require('../rpc/rpc_error');

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
    delete_bucket_public_access_block: { regular: "s3:PutBucketPublicAccessBlock" },
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
    get_bucket_request_payment: { regular: "s3:GetBucketRequestPayment" },
    get_bucket_tagging: { regular: "s3:GetBucketTagging" },
    get_bucket_uploads: { regular: "s3:ListBucketMultipartUploads" },
    get_bucket_versioning: { regular: "s3:GetBucketVersioning" },
    get_bucket_versions: { regular: "s3:ListBucketVersions" },
    get_bucket_website: { regular: "s3:GetBucketWebsite" },
    get_bucket_object_lock: { regular: "s3:GetBucketObjectLockConfiguration" },
    get_bucket_public_access_block: { regular: "s3:GetBucketPublicAccessBlock" },
    get_bucket: { regular: "s3:ListBucket" },
    get_object_acl: { regular: "s3:GetObjectAcl" },
    get_object_attributes: { regular: ["s3:GetObject", "s3:GetObjectAttributes"], versioned: ["s3:GetObjectVersion", "s3:GetObjectVersionAttributes"] }, // Notice - special case
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
    post_object_restore: { regular: "s3:RestoreObject" },

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
    put_bucket_request_payment: { regular: "s3:PutBucketRequestPayment" },
    put_bucket_tagging: { regular: "s3:PutBucketTagging" },
    put_bucket_versioning: { regular: "s3:PutBucketVersioning" },
    put_bucket_website: { regular: "s3:PutBucketWebsite" },
    put_bucket_object_lock: { regular: "s3:PutBucketObjectLockConfiguration" },
    put_bucket_public_access_block: { regular: "s3:PutBucketPublicAccessBlock" },
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
const IAM_DEFAULT_PATH = '/';

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
    's3:x-amz-server-side-encryption': _is_server_side_encryption_fit,
    's3:VersionId': _is_object_version_fit
};

//https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html#amazons3-policy-keys
const supported_actions = {
    's3:ExistingObjectTag': ['s3:DeleteObjectTagging', 's3:DeleteObjectVersionTagging', 's3:GetObject', 's3:GetObjectAcl', 's3:GetObjectTagging', 's3:GetObjectVersion', 's3:GetObjectVersionTagging', 's3:PutObjectAcl', 's3:PutObjectTagging', 's3:PutObjectVersionTagging'],
    's3:x-amz-server-side-encryption': ['s3:PutObject'],
    's3:VersionId': ['s3:GetObjectVersion', 's3:DeleteObjectVersion', 's3:GetObjectVersionAttributes', 's3:GetObjectVersionTagging', 's3:PutObjectVersionTagging', 's3:DeleteObjectVersionTagging']
};

const SUPPORTED_BUCKET_POLICY_CONDITIONS = Object.keys(supported_actions);

async function _is_server_side_encryption_fit(req, predicate, value) {
    const encryption = s3_utils.parse_encryption(req);
    const algorithm = encryption ? encryption.algorithm : null;
    const res = predicate(algorithm, value);
    dbg.log1('access_policy: encryption fit?', value, algorithm, res);
    return res;
}

async function _is_object_tag_fit(req, predicate, value) {
    const reply = await req.object_sdk.get_object_tagging(req.params);
    const tag = reply?.tagging?.find(element => (element.key === value.key));
    const tag_value = tag ? tag.value : null;
    const res = predicate(tag_value, value.value);
    dbg.log1('access_policy: object tag fit?', value, tag, res);
    return res;
}
async function _is_object_version_fit(req, predicate, value) {
    const version_id = req.query.versionId;
    const res = predicate(version_id, value);
    dbg.log1('access_policy: version-id fit? version-id, policy version-id, match :', version_id, value, res);
    return res;
}

/**
 * has_access_policy_permission validate the access policy
 * 
 * @param {object} policy
 * @param {string[] | string} account
 * @param {string[] | string} method
 * @param {string} arn_path
 * @param {object} req
 */
async function has_access_policy_permission(policy, account, method, arn_path, req,
    { disallow_public_access = false, should_pass_principal = true } = {}) {
    const [allow_statements, deny_statements] = _.partition(policy.Statement, statement => statement.Effect === 'Allow');

    // the case where the permission is an array started in op get_object_attributes
    const method_arr = Array.isArray(method) ? method : [method];
    const account_arr = Array.isArray(account) ? account : [account];

    // look for explicit denies
    const res_arr_deny = await is_statement_fit_of_method_array(
        deny_statements, account_arr, method_arr, arn_path, req, {
            disallow_public_access: false, // No need to disallow in "DENY"
            should_pass_principal
        }
    );
    if (res_arr_deny.every(item => item)) return 'DENY';

    // look for explicit allows
    const res_arr_allow = await is_statement_fit_of_method_array(
        allow_statements, account_arr, method_arr, arn_path, req, {
            disallow_public_access,
            should_pass_principal
        });
    if (res_arr_allow.every(item => item)) return 'ALLOW';

    // implicit deny
    return 'IMPLICIT_DENY';
}

function _is_action_fit(method, statement) {
    const statement_action = statement.Action || statement.NotAction;
    let action_fit = false;
    for (const action of _.flatten([statement_action])) {
        dbg.log1('access_policy: ', statement.Action ? 'Action' : 'NotAction', ' fit?', action, method);
        if ((action === '*') || (action === 's3:*') || (action === method)) {
            action_fit = true;
            break;
        }
    }
    return statement.Action ? action_fit : !action_fit;
}

function _is_principal_fit(account_arr, statement, ignore_public_principal = false) {
    let statement_principal = statement.Principal || statement.NotPrincipal;

    let principal_fit = false;
    statement_principal = statement_principal.AWS ? statement_principal.AWS : statement_principal;
    for (const principal of _.flatten([statement_principal])) {
        dbg.log1('access_policy: ', statement.Principal ? 'Principal' : 'NotPrincipal', ' fit?', principal, account_arr);
        if ((principal.unwrap() === '*') || account_arr.includes(principal.unwrap())) {
            if (ignore_public_principal && principal.unwrap() === '*' && statement.Principal) {
                // Ignore the "fit" if ignore_public_principal is requested
                continue;
            }

            principal_fit = true;
            break;
        }
    }
    return statement.Principal ? principal_fit : !principal_fit;
}

function _is_resource_fit(arn_path, statement) {
    const statement_resource = statement.Resource || statement.NotResource;
    let resource_fit = false;
    for (const resource of _.flatten([statement_resource])) {
        //convert aws resource regex to javascript regex 
        const resource_regex = RegExp(`^${resource.replace(qm_regex, '.?').replace(ar_regex, '.*')}$`);
        dbg.log1('access_policy: ', statement.Resource ? 'Resource' : 'NotResource', ' fit?', resource_regex, arn_path);
        if (resource_regex.test(arn_path)) {
            resource_fit = true;
            break;
        }
    }
    return statement.Resource ? resource_fit : !resource_fit;
}

async function is_statement_fit_of_method_array(statements, account_arr, method_arr, arn_path, req,
    { disallow_public_access = false, should_pass_principal = true } = {}) {
    return Promise.all(method_arr.map(method_permission =>
        _is_statements_fit(statements, account_arr, method_permission, arn_path, req, { disallow_public_access, should_pass_principal })));
}

async function _is_statements_fit(statements, account_arr, method, arn_path, req,
    { disallow_public_access = false, should_pass_principal = true} = {}) {
    for (const statement of statements) {
        const action_fit = _is_action_fit(method, statement);
        // When evaluating IAM user inline policies, should_pass_principal is false since these policies
        // don't have a Principal field (the principal is implicitly the user)
        const principal_fit = should_pass_principal ? _is_principal_fit(account_arr, statement, disallow_public_access) : true;
        const resource_fit = _is_resource_fit(arn_path, statement);
        const condition_fit = await _is_condition_fit(statement, req, method);

        dbg.log1('access_policy - is_statements_fit: action_fit, principal_fit, resource_fit, condition_fit', action_fit, principal_fit, resource_fit, condition_fit);
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

async function validate_bucket_policy(policy, bucket_name, get_account_handler) {
    const all_op_names = _.flatten(_.compact(_.flatMap(OP_NAME_TO_ACTION, action => [action.regular, action.versioned])));
    for (const statement of policy.Statement) {

        const statement_principal = statement.Principal || statement.NotPrincipal;
        if (statement_principal.AWS) {
            for (const principal of _.flatten([statement_principal.AWS])) {
                if ((typeof principal === 'string') ? principal !== '*' : principal.unwrap() !== '*') {
                    const account = await get_account_handler(principal);
                    if (!account) {
                        throw new RpcError('MALFORMED_POLICY', 'Invalid principal in policy', { detail: principal });
                    }
                }
            }
        } else if ((typeof statement_principal === 'string') ? statement_principal !== '*' : statement_principal.unwrap() !== '*') {
            throw new RpcError('MALFORMED_POLICY', 'Invalid principal in policy', { detail: statement.Principal });
        }
        for (const resource of _.flatten([statement.Resource || statement.NotResource])) {
            const resource_bucket_part = resource.split('/')[0];
            const resource_regex = RegExp(`^${resource_bucket_part.replace(qm_regex, '.?').replace(ar_regex, '.*')}$`);
            if (!resource_regex.test('arn:aws:s3:::' + bucket_name)) {
                throw new RpcError('MALFORMED_POLICY', 'Policy has invalid resource', { detail: resource });
            }
        }
        for (const action of _.flatten([statement.Action || statement.NotAction])) {
            if (action !== 's3:*' && !all_op_names.includes(action)) {
                throw new RpcError('MALFORMED_POLICY', 'Policy has invalid action', { detail: action });
            }
        }
        if (statement.Condition) {
            for (const condition of Object.values(statement.Condition)) {
                for (const condition_key of Object.keys(condition)) {
                    // some condition keys have arguments in their names.(e.g. s3:ExistingObjectTag/<key>)
                    // parse to get only the condition key itself
                    const key_parts = condition_key.split("/");
                    if (!SUPPORTED_BUCKET_POLICY_CONDITIONS.includes(key_parts[0])) {
                        throw new RpcError('MALFORMED_POLICY', 'Policy has invalid condition key or unsupported condition key', { detail: condition_key });
                    }
                }
            }
        }
        // TODO: Need to validate that the resource comply with the action
    }
}

/**
 * allows_public_access returns true if a policy will allow public access
 * to a resource
 * 
 * NOTE: It assumes that the given policy has already been validated
 * @param {*} policy 
 * @returns {boolean}
 */
function allows_public_access(policy) {
    for (const statement of policy.Statement) {
        if (statement.Effect === 'Deny') continue;

        const statement_principal = statement.Principal;
        if (statement_principal.AWS) {
            for (const principal of _.flatten([statement_principal.AWS])) {
                if (typeof principal === 'string' ? principal === '*' : principal.unwrap() === '*') {
                    return true;
                }
            }
        } else if (typeof statement_principal === 'string' ? statement_principal === '*' : statement_principal.unwrap() === '*') {
            return true;
        }
    }

    return false;
}

/**
 * Return IAM ARN for account, if account dont have owner
 * and User, if the user do have account ower
 *
 * @param {Object} account 
 * @returns {string}
 */
function get_bucket_policy_principal_arn(account) {
    const bucket_policy_arn = account.owner ? create_arn_for_user(account.owner, account.name.unwrap().split(':')[0], account.iam_path) :
                                        create_arn_for_root(account._id);
    return bucket_policy_arn;
}

/**
 *  Both NSFS NC and containerized will validate bucket policy against acccount id 
 *  but in containerized deplyment not against IAM user ID.
 * 
 * @param {boolean} is_nc_deployment
 * @param {object} account
 */
function get_account_identifier_id(is_nc_deployment, account) {
    if (is_nc_deployment || account.owner === undefined) {
        return account._id;
    }
}

/**
 * create_arn_for_root creates the AWS ARN for root account user
 * see: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html#identifiers-arns
 * @param {nb.ID} account_id (the root user account id)
 */
function create_arn_for_root(account_id) {
    return `arn:aws:iam::${account_id}:root`;
}

/**
 * create_arn_for_user creates the AWS ARN for user
 * see: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html#identifiers-arns
 * @param {nb.ID} account_id (the root user account id)
 * @param {string} username
 * @param {string} iam_path
 */
function create_arn_for_user(account_id, username, iam_path) {
    const basic_structure = `arn:aws:iam::${account_id}:user`;
    if (username === undefined) return `${basic_structure}/`;
    if (check_iam_path_was_set(iam_path)) {
        return `${basic_structure}${iam_path}${username}`;
    }
    return `${basic_structure}/${username}`;
}

/**
 * check_iam_path_was_set return true if the iam_path was set
 * @param {string} iam_path
 */
function check_iam_path_was_set(iam_path) {
    return iam_path && iam_path !== IAM_DEFAULT_PATH;
}

exports.OP_NAME_TO_ACTION = OP_NAME_TO_ACTION;
exports.has_access_policy_permission = has_access_policy_permission;
exports.validate_bucket_policy = validate_bucket_policy;
exports.allows_public_access = allows_public_access;
exports.get_bucket_policy_principal_arn = get_bucket_policy_principal_arn;
exports.create_arn_for_root = create_arn_for_root;
exports.get_account_identifier_id = get_account_identifier_id;
