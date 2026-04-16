/* Copyright (C) 2025 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const VectorError = require('./vector_errors').VectorError;
const VectorSDK = require('../../sdk/vector_sdk');
const js_utils = require('../../util/js_utils');
const http_utils = require('../../util/http_utils');
const signature_utils = require('../../util/signature_utils');
const access_policy_utils = require('../../util/access_policy_utils');
const { get_owner_account_id } = require('../iam/iam_utils');
const lance = js_utils.require_optional('@lancedb/lancedb');

const VECTOR_MAX_BODY_LEN = 4 * 1024 * 1024; //TODO - validate

const RPC_ERRORS_TO_VECTOR = Object.freeze({ //TODO - validate
    SIGNATURE_DOES_NOT_MATCH: VectorError.AccessDeniedException,
    UNAUTHORIZED: VectorError.AccessDeniedException,
    INVALID_ACCESS_KEY_ID: VectorError.InvalidClientTokenId,
    DEACTIVATED_ACCESS_KEY_ID: VectorError.InvalidClientTokenIdInactiveAccessKey,
    NO_SUCH_BUCKET: VectorError.NotFoundException,
    NO_SUCH_ACCOUNT: VectorError.AccessDeniedException,
    NO_SUCH_ROLE: VectorError.AccessDeniedException,
    VALIDATION_ERROR: VectorError.ValidationException,
    /*INVALID_INPUT: VectorError.InvalidInput,
    MALFORMED_POLICY_DOCUMENT: VectorError.MalformedPolicyDocument,
    ENTITY_ALREADY_EXISTS: VectorError.EntityAlreadyExists,
    NO_SUCH_ENTITY: VectorError.NoSuchEntity,
    CONCURRENT_MODIFICATION: VectorError.ConcurrentModification,
    LIMIT_EXCEEDED: VectorError.LimitExceeded,
    SERVICE_FAILURE: VectorError.ServiceFailure,
    DELETE_CONFLICT: VectorError.DeleteConflict,
    ENTITY_TEMPORARILY_UNMODIFIABLE: VectorError.EntityTemporarilyUnmodifiable,*/
    INVALID_PARAMETER_VALUE: VectorError.InvalidParameterValue,
    EXPIRED_TOKEN: VectorError.ExpiredToken,
    ACCESS_DENIED_EXCEPTION: VectorError.AccessDeniedException,
    NOT_AUTHORIZED: VectorError.NotAuthorized,
    INTERNAL_FAILURE: VectorError.InternalFailure,
    VECTOR_BUCKET_NOT_EMPTY: VectorError.VectorBucketNotEmpty,
});

const VECTOR_OPS = js_utils.deep_freeze({
    CreateVectorBucket: {
        handler: require('./ops/vector_bucket_create'),
        load_vector_bucket: false,
        load_vector_index: false,
    },
    GetVectorBucket: {
        handler: require('./ops/vector_bucket_get'),
        load_vector_bucket: true,
        load_vector_index: false,
    },
    DeleteVectorBucket: {
        handler: require('./ops/vector_bucket_delete'),
        load_vector_bucket: true,
        load_vector_index: false,
    },
    ListVectorBuckets: {
        handler: require('./ops/vector_list_vector_buckets'),
        load_vector_bucket: false,
        load_vector_index: false,
    },
    CreateIndex: {
        handler: require('./ops/vector_index_create'),
        load_vector_bucket: true,
        load_vector_index: false,
    },
    GetIndex: {
        handler: require('./ops/vector_index_get'),
        load_vector_bucket: true,
        load_vector_index: true,
    },
    ListIndexes: {
        handler: require('./ops/vector_index_list'),
        load_vector_bucket: true,
        load_vector_index: false,
    },
    DeleteIndex: {
        handler: require('./ops/vector_index_delete'),
        load_vector_bucket: true,
        load_vector_index: true,
    },
    PutVectors: {
        handler: require('./ops/vector_put_vectors'),
        load_vector_bucket: true,
        load_vector_index: true,
    },
    ListVectors: {
        handler: require('./ops/vector_list_vectors'),
        load_vector_bucket: true,
        load_vector_index: true,
    },
    QueryVectors: {
        handler: require('./ops/vector_query_vectors'),
        load_vector_bucket: true,
        load_vector_index: true,
    },
    DeleteVectors: {
        handler: require('./ops/vector_delete_vectors'),
        load_vector_bucket: true,
        load_vector_index: true,
    },
    PutVectorBucketPolicy: {
        handler: require('./ops/vector_put_vector_bucket_policy'),
        load_vector_bucket: true,
        load_vector_index: false,
    },
    GetVectorBucketPolicy: {
        handler: require('./ops/vector_get_vector_bucket_policy'),
        load_vector_bucket: true,
        load_vector_index: false,
    },
    DeleteVectorBucketPolicy: {
        handler: require('./ops/vector_delete_vector_bucket_policy'),
        load_vector_bucket: true,
        load_vector_index: false,
    },
});

async function vector_rest(req, res) {
    try {
        await handle_request(req, res);
    } catch (err) {
        handle_error(req, res, err);
    }
}

async function handle_request(req, res) {

    if (!lance) {
        throw new VectorError({
            code: "NotAvailable",
            message: "Vector API is not available in this server.",
            http_code: 501,
        });
    }

    http_utils.set_amz_headers(req, res);

    if (req.method === 'OPTIONS') {
        dbg.log1('OPTIONS!');
        res.statusCode = 200;
        res.end();
        return;
    }

    const headers_options = {
        ErrorClass: VectorError,
        error_invalid_argument: VectorError.InvalidParameterValue,
        error_access_denied: VectorError.AccessDeniedException,
        error_bad_request: VectorError.InternalFailure,
        error_invalid_digest: VectorError.InternalFailure,
        error_request_time_too_skewed: VectorError.InternalFailure,
        error_missing_content_length: VectorError.InternalFailure,
        error_invalid_token: VectorError.InvalidClientTokenId,
        error_token_expired: VectorError.ExpiredToken,
        auth_token: () => signature_utils.make_auth_token_from_request(req)
    };
    http_utils.check_headers(req, headers_options);

    const options = {
        body: {
            type: 'json',
            optional: false
        },
        reply: {type: 'json'},
        MAX_BODY_LEN: VECTOR_MAX_BODY_LEN,
        ErrorClass: VectorError,
        error_max_body_len_exceeded: VectorError.InternalFailure,
        error_missing_body: VectorError.InternalFailure,
        error_invalid_body: VectorError.InternalFailure,
        error_body_sha256_mismatch: VectorError.InternalFailure,
    };
    await http_utils.read_and_parse_body(req, options);

    const op_name = req.originalUrl.startsWith('/') ? req.originalUrl.substring(1) : req.originalUrl;
    const op = VECTOR_OPS[op_name];
    if (!op || !op.handler) {
        dbg.error('Vector (NotImplemented)', op_name, req.method, req.originalUrl);
        throw new VectorError(VectorError.NotImplemented);
    }
    req.op_name = op_name;

    http_utils.authorize_session_token(req, headers_options);
    authenticate_request(req);
    await req.object_sdk.load_requesting_account(req);
    await req.object_sdk.authorize_request_account(req);

    dbg.log1('VECTOR REQUEST', req.method, req.originalUrl, 'op', op_name, 'request_id', req.request_id, req.headers);

    //init vector_sdk here to avoid creating this object for s3 reqs that don't need it
    //TODO - find a better place to get BS?
    req.vector_sdk = new VectorSDK({
        bucketspace: req.object_sdk._get_bucketspace(),
        req
    });
    await req.vector_sdk.load_vector_bucket_and_index(op);
    await authorize_request_vector_policy(req);
    const reply = await op.handler.handler(req, res);
    dbg.log0("VECTOR reply =", reply);

    http_utils.send_reply(req, res, reply, options);
}

function authenticate_request(req) {
    try {
        signature_utils.authenticate_request_by_service(req, req.object_sdk);
    } catch (err) {
        dbg.error('authenticate_request: ERROR', err.stack || err);
        if (err.code) {
            throw err;
        } else {
            throw new VectorError(VectorError.AccessDeniedException);
        }
    }
}

/**
 * Same ownership idea as {@link authorize_request_policy} in s3_rest.js (bucket owner / OBC claim / IAM root).
 * @param {object} req
 * @param {object} account
 * @param {boolean} is_nc_deployment
 */
function _is_vector_bucket_owner(req, account, is_nc_deployment) {
    const vb = req.vector_bucket;
    if (!vb || !vb.owner_account) return false;
    const owner = vb.owner_account;
    const vector_bucket_name = req.body && req.body.vectorBucketName;
    const account_identifier_name = is_nc_deployment ? account.name.unwrap() : account.email.unwrap();

    if (account.bucket_claim_owner && vector_bucket_name &&
        account.bucket_claim_owner.unwrap() === vector_bucket_name) {
        return true;
    }
    if (owner.id !== undefined && owner.id !== null && String(owner.id) === String(account._id)) {
        return true;
    }
    if (account.owner === undefined && owner.email !== undefined && owner.email !== null) {
        const owner_email = typeof owner.email.unwrap === 'function' ? owner.email.unwrap() : owner.email;
        if (account_identifier_name === owner_email) return true;
    }
    return false;
}

async function authorize_request_vector_policy(req) {
    const vector_bucket_name = req.body && req.body.vectorBucketName;
    if (!vector_bucket_name) return;
    if (req.op_name === 'CreateVectorBucket') return;

    if (!req.vector_bucket) return;

    const method = access_policy_utils.VECTOR_OP_NAME_TO_ACTION[req.op_name];
    if (!method) {
        dbg.error(`authorize_request_vector_policy: unsupported vector op ${req.op_name}`);
        throw new VectorError(VectorError.InternalFailure);
    }
    const arn_path = `arn:aws:s3vectors:::${vector_bucket_name}`;
    const vector_policy = req.vector_bucket.vector_policy;

    const auth_token = req.object_sdk.get_auth_token();
    const is_anon = !(auth_token && auth_token.access_key);

    // Anonymous: align with authorize_anonymous_access — no policy ⇒ deny; need explicit ALLOW.
    if (is_anon) {
        if (!vector_policy) throw new VectorError(VectorError.AccessDeniedException);
        const permission = await access_policy_utils.has_access_policy_permission(
            vector_policy, undefined, method, arn_path, req
        );
        if (permission === 'ALLOW') return;
        throw new VectorError(VectorError.AccessDeniedException);
    }

    const account = req.object_sdk.requesting_account;
    const is_nc_deployment = Boolean(req.object_sdk.nsfs_config_root);

    // No bucket policy: same as s3_rest when !s3_policy — only owner or IAM user under that root account.
    if (!vector_policy) {
        const is_owner = _is_vector_bucket_owner(req, account, is_nc_deployment);
        let is_iam_account_and_same_root_account_owner = false;
        if (account.owner !== undefined && req.vector_bucket.owner_account) {
            const vb_owner_id = req.vector_bucket.owner_account.id;
            const requesting_owner_id = get_owner_account_id(account);
            is_iam_account_and_same_root_account_owner =
                requesting_owner_id !== undefined &&
                requesting_owner_id !== null &&
                String(requesting_owner_id) === String(vb_owner_id);
        }
        if (is_owner || is_iam_account_and_same_root_account_owner) return;
        throw new VectorError(VectorError.AccessDeniedException);
    }

    const account_identifiers = [];
    const account_identifier_id = access_policy_utils.get_account_identifier_id(is_nc_deployment, account);
    if (account_identifier_id) account_identifiers.push(account_identifier_id);
    if (is_nc_deployment && account.owner === undefined) {
        account_identifiers.push(account.name.unwrap());
    }
    if (!is_nc_deployment) {
        account_identifiers.push(access_policy_utils.get_bucket_policy_principal_arn(account));
    }

    const permission = await access_policy_utils.has_access_policy_permission(
        vector_policy, account_identifiers, method, arn_path, req
    );
    dbg.log3('authorize_request_vector_policy: permission', permission);
    if (permission === 'DENY') throw new VectorError(VectorError.AccessDeniedException);

    let permission_by_owner;
    if (!is_nc_deployment && account.owner !== undefined) {
        const owner_account_id = get_owner_account_id(account);
        const owner_account_identifier_arn = access_policy_utils.create_arn_for_root(owner_account_id);
        permission_by_owner = await access_policy_utils.has_access_policy_permission(
            vector_policy, [owner_account_identifier_arn, owner_account_id], method, arn_path, req
        );
        dbg.log3('authorize_request_vector_policy permission_by_owner', permission_by_owner);
        if (permission_by_owner === 'DENY') throw new VectorError(VectorError.AccessDeniedException);
    }

    if (permission === 'ALLOW' || permission_by_owner === 'ALLOW' || _is_vector_bucket_owner(req, account, is_nc_deployment)) {
        return;
    }
    throw new VectorError(VectorError.AccessDeniedException);
}

function handle_error(req, res, err) {
    const vector_err =
        ((err instanceof VectorError) && err) ||
        new VectorError(RPC_ERRORS_TO_VECTOR[err.rpc_code] || VectorError.InternalFailure);
    if (req.object_sdk && !req.object_sdk.nsfs_config_root) {
        vector_err.message = err.message;
    }
    const reply = vector_err.reply();
    dbg.error('VECTOR ERROR', reply,
        req.method, req.originalUrl,
        JSON.stringify(req.headers),
        err.stack || err);
    if (res.headersSent) {
        dbg.log0('Sending error in body, but too late for headers...');
    } else {
        res.statusCode = vector_err.http_code;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('x-amzn-ErrorType', vector_err.code);
        res.setHeader('Content-Length', Buffer.byteLength(reply));
    }
    res.end(reply);
}

// EXPORTS
module.exports = vector_rest;
