/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const IamError = require('./iam_errors').IamError;
const js_utils = require('../../util/js_utils');
const http_utils = require('../../util/http_utils');
const signature_utils = require('../../util/signature_utils');

const IAM_MAX_BODY_LEN = 4 * 1024 * 1024;

const IAM_XML_ROOT_ATTRS = Object.freeze({
    xmlns: 'https://iam.amazonaws.com/doc/2010-05-08/'
});

const RPC_ERRORS_TO_IAM = Object.freeze({
    SIGNATURE_DOES_NOT_MATCH: IamError.AccessDeniedException,
    UNAUTHORIZED: IamError.AccessDeniedException,
    INVALID_ACCESS_KEY_ID: IamError.InvalidClientTokenId,
    DEACTIVATED_ACCESS_KEY_ID: IamError.InvalidClientTokenIdInactiveAccessKey,
    NO_SUCH_ACCOUNT: IamError.AccessDeniedException,
    NO_SUCH_ROLE: IamError.AccessDeniedException,
    VALIDATION_ERROR: IamError.ValidationError,
    MALFORMED_POLICY_DOCUMENT: IamError.MalformedPolicyDocument,
});

const ACTIONS = Object.freeze({
    'CreateUser': 'create_user',
    'GetUser': 'get_user',
    'UpdateUser': 'update_user',
    'DeleteUser': 'delete_user',
    'ListUsers': 'list_users',
    'CreateAccessKey': 'create_access_key',
    'GetAccessKeyLastUsed': 'get_access_key_last_used',
    'UpdateAccessKey': 'update_access_key',
    'DeleteAccessKey': 'delete_access_key',
    'ListAccessKeys': 'list_access_keys',
    'PutUserPolicy': 'put_user_policy',
    'GetUserPolicy': 'get_user_policy',
    'DeleteUserPolicy': 'delete_user_policy',
    'ListUserPolicies': 'list_user_policies',
    'ListGroupsForUser': 'list_groups_for_user',
    'ListAccountAliases': 'list_account_aliases',
    'ListAttachedGroupPolicies': 'list_attached_group_policies',
    'ListAttachedRolePolicies': 'list_attached_role_policies',
    'ListAttachedUserPolicies': 'list_attached_user_policies',
    'ListEntitiesForPolicy': 'list_entities_for_policy',
    'ListGroupPolicies': 'list_group_policies',
    'ListGroups': 'list_groups',
    'ListInstanceProfiles': 'list_instance_profiles',
    'ListInstanceProfilesForRole': 'list_instance_profiles_for_role',
    'ListInstanceProfileTags': 'list_instance_profile_tags',
    'ListMFADevices': 'list_mfa_devices',
    'ListMFADeviceTags': 'list_mfa_device_tags',
    'ListOpenIDConnectProviders': 'list_open_id_connect_providers',
    'ListOpenIDConnectProviderTags': 'list_open_id_connect_provider_tags',
    'ListPolicies': 'list_policies',
    'ListPolicyTags': 'list_policy_tags',
    'ListPolicyVersions': 'list_policy_versions',
    'ListRoles': 'list_roles',
    'ListRoleTags': 'list_role_tags',
    'ListSAMLProviders': 'list_saml_providers',
    'ListServerCertificates': 'list_server_certificates',
    'ListServerCertificateTags': 'list_server_certificate_tags',
    'ListServiceSpecificCredentials': 'list_service_specific_credentials',
    'ListSigningCertificates': 'list_signing_certificates',
    'ListSSHPublicKeys': 'list_ssh_public_keys',
    'ListUserTags': 'list_user_tags',
    'ListVirtualMFADevices': 'list_virtual_mfa_devices',
});

// notice: shows all methods as method post
const IAM_OPS = js_utils.deep_freeze({
    // user CRUD
    post_create_user: require('./ops/iam_create_user'),
    post_get_user: require('./ops/iam_get_user'),
    post_update_user: require('./ops/iam_update_user'),
    post_delete_user: require('./ops/iam_delete_user'),
    post_list_users: require('./ops/iam_list_users'),
    // access key CRUD
    post_create_access_key: require('./ops/iam_create_access_key'),
    post_get_access_key_last_used: require('./ops/iam_get_access_key_last_used'),
    post_update_access_key: require('./ops/iam_update_access_key'),
    post_delete_access_key: require('./ops/iam_delete_access_key'),
    post_list_access_keys: require('./ops/iam_list_access_keys'),
    // user policy
    post_put_user_policy: require('./ops/iam_put_user_policy'),
    post_get_user_policy: require('./ops/iam_get_user_policy'),
    post_delete_user_policy: require('./ops/iam_delete_user_policy'),
    post_list_user_policies: require('./ops/iam_list_user_policies'),
    // other (currently ops that return empty or NoSuchEntity error - just not to fail them)
    post_list_groups_for_user: require('./ops/iam_list_groups_for_user'),
    post_list_account_aliases: require('./ops/iam_list_account_aliases'),
    post_list_attached_group_policies: require('./ops/iam_list_attached_group_policies'),
    post_list_attached_role_policies: require('./ops/iam_list_attached_role_policies'),
    post_list_attached_user_policies: require('./ops/iam_list_attached_user_policies'),
    post_list_entities_for_policy: require('./ops/iam_list_entities_for_policy'),
    post_list_group_policies: require('./ops/iam_list_group_policies'),
    post_list_groups: require('./ops/iam_list_groups'),
    post_list_instance_profiles: require('./ops/iam_list_instance_profiles'),
    post_list_instance_profiles_for_role: require('./ops/iam_list_instance_profiles_for_role'),
    post_list_instance_profile_tags: require('./ops/iam_list_instance_profile_tags'),
    post_list_mfa_devices: require('./ops/iam_list_mfa_devices'),
    post_list_mfa_device_tags: require('./ops/iam_list_mfa_device_tags'),
    post_list_open_id_connect_providers: require('./ops/iam_list_open_id_connect_providers'),
    post_list_open_id_connect_provider_tags: require('./ops/iam_list_open_id_connect_provider_tags'),
    post_list_policies: require('./ops/iam_list_policies'),
    post_list_policy_tags: require('./ops/iam_list_policy_tags'),
    post_list_policy_versions: require('./ops/iam_list_policy_versions'),
    post_list_roles: require('./ops/iam_list_roles'),
    post_list_role_tags: require('./ops/iam_list_role_tags'),
    post_list_saml_providers: require('./ops/iam_list_saml_providers'),
    post_list_server_certificates: require('./ops/iam_list_server_certificates'),
    post_list_server_certificate_tags: require('./ops/iam_list_server_certificate_tags'),
    post_list_service_specific_credentials: require('./ops/iam_list_service_specific_credentials'),
    post_list_signing_certificates: require('./ops/iam_list_signing_certificates'),
    post_list_ssh_public_keys: require('./ops/iam_list_ssh_public_keys'),
    post_list_user_tags: require('./ops/iam_list_user_tags'),
    post_list_virtual_mfa_devices: require('./ops/iam_list_virtual_mfa_devices'),
});

async function iam_rest(req, res) {
    try {
        await handle_request(req, res);
    } catch (err) {
        handle_error(req, res, err);
    }
}

async function handle_request(req, res) {

    http_utils.set_amz_headers(req, res);

    if (req.method === 'OPTIONS') {
        dbg.log1('OPTIONS!');
        res.statusCode = 200;
        res.end();
        return;
    }

    const headers_options = {
        ErrorClass: IamError,
        error_invalid_argument: IamError.InvalidParameterValue,
        error_access_denied: IamError.AccessDeniedException,
        error_bad_request: IamError.InternalFailure,
        error_invalid_digest: IamError.InternalFailure,
        error_request_time_too_skewed: IamError.InternalFailure,
        error_missing_content_length: IamError.InternalFailure,
        error_invalid_token: IamError.InvalidClientTokenId,
        error_token_expired: IamError.ExpiredToken,
        auth_token: () => signature_utils.make_auth_token_from_request(req)
    };
    http_utils.check_headers(req, headers_options);

    const options = {
        body: { type: req.headers['content-type'] },
        MAX_BODY_LEN: IAM_MAX_BODY_LEN,
        XML_ROOT_ATTRS: IAM_XML_ROOT_ATTRS,
        ErrorClass: IamError,
        error_max_body_len_exceeded: IamError.InternalFailure,
        error_missing_body: IamError.InternalFailure,
        error_invalid_body: IamError.InternalFailure,
        error_body_sha256_mismatch: IamError.InternalFailure,
    };
    verify_op_request_body_type(req);
    await http_utils.read_and_parse_body(req, options);

    const op_name = parse_op_name(req, req.body.action);
    const op = IAM_OPS[op_name];
    if (!op || !op.handler) {
        dbg.error('IAM (NotImplemented)', op_name, req.method, req.originalUrl);
        throw new IamError(IamError.NotImplemented);
    }
    req.op_name = op_name;

    http_utils.authorize_session_token(req, headers_options);
    authenticate_request(req);
    await authorize_request(req);

    dbg.log1('IAM REQUEST', req.method, req.originalUrl, 'op', op_name, 'request_id', req.request_id, req.headers);

    const reply = await op.handler(req, res);
    add_response_metadata_if_not_exists(reply, req.request_id); // unique to IAM
    http_utils.send_reply(req, res, reply, {
        ...options,
        body: op.body,
        reply: op.reply
    });
}

function authenticate_request(req) {
    try {
        signature_utils.authenticate_request_by_service(req, req.account_sdk);
    } catch (err) {
        dbg.error('authenticate_request: ERROR', err.stack || err);
        if (err.code) {
            throw err;
        } else {
            throw new IamError(IamError.AccessDeniedException);
        }
    }
}

// authorize_request_account authorizes the account of the requester
async function authorize_request(req) {
    await req.account_sdk.load_requesting_account(req);
    req.account_sdk.authorize_request_account(req);
}

function parse_op_name(req, action) {
    const method = req.method.toLowerCase();
    if (ACTIONS[action]) {
        return `${method}_${ACTIONS[action]}`;
    }
    dbg.error('IAM parse_op_name - NotImplemented', action, method, req.originalUrl);
    throw new IamError(IamError.NotImplemented);
}

function handle_error(req, res, err) {
    const iam_err =
        ((err instanceof IamError) && err) ||
        new IamError(RPC_ERRORS_TO_IAM[err.rpc_code] || IamError.InternalFailure);

    const reply = iam_err.reply(req.request_id);
    dbg.error('IAM ERROR', reply,
        req.method, req.originalUrl,
        JSON.stringify(req.headers),
        err.stack || err);
    if (res.headersSent) {
        dbg.log0('Sending error xml in body, but too late for headers...');
    } else {
        res.statusCode = iam_err.http_code;
        res.setHeader('Content-Type', 'text/xml'); // based on actual header seen in AWS CLI
        res.setHeader('Content-Length', Buffer.byteLength(reply));
    }
    res.end(reply);
}

// we only support request with specific type
function verify_op_request_body_type(req) {
    const headers = req.headers['content-type'];
    if (headers === undefined || !headers.includes(http_utils.CONTENT_TYPE_APP_FORM_URLENCODED)) {
        dbg.error(`verify_op_request_body_type: should have header ${http_utils.CONTENT_TYPE_APP_FORM_URLENCODED} ` +
            `in request, currently the headers are: ${headers}`);
        // GAP - need to make sure which error we need to throw
        throw new IamError(IamError.InvalidParameterValue);
    }
}

// this function was added to protect the structure of IAM reply
// and make sure that every op has ResponseMetadata inside it 
// (in case developers add new ops in endpoint/iam/ops and accidentally did not add it)
// structure of reply: { <op>Response { <op>Result (if exists), ResponseMetadata } }
function add_response_metadata_if_not_exists(reply, request_id) {
    const reply_keys = Object.keys(reply);
    if (reply_keys.length !== 1) {
        dbg.error('add_response_metadata_if_not_exists: reply structure does not meet standards' +
        'should have only one object inside reply');
        throw new IamError(IamError.InternalFailure);
    }
    const reply_response_key = reply_keys[0];
    const reply_response_object = reply[reply_response_key];
    const response_metadata = reply_response_object.ResponseMetadata;
    if (!response_metadata) {
        reply_response_object.ResponseMetadata = {
            RequestId: request_id,
        };
    }
}

// EXPORTS
module.exports = iam_rest;
