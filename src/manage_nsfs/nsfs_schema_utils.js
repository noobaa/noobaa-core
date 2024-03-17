/* Copyright (C) 2023 NooBaa */
'use strict';

const _ = require('lodash');
const RpcError = require('../rpc/rpc_error');
const { default: Ajv } = require('ajv');
const ajv = new Ajv({ verbose: true, allErrors: true });
const { KEYWORDS } = require('../util/schema_keywords');
const common_api = require('../api/common_api');
const schema_utils = require('../util/schema_utils');

ajv.addKeyword(KEYWORDS.methods);
ajv.addKeyword(KEYWORDS.doc);
ajv.addKeyword(KEYWORDS.date);
ajv.addKeyword(KEYWORDS.idate);
ajv.addKeyword(KEYWORDS.objectid);
ajv.addKeyword(KEYWORDS.binary);
ajv.addKeyword(KEYWORDS.wrapper);
ajv.addSchema(common_api);

const bucket_schema = require('../server/system_services/schemas/nsfs_bucket_schema');
const account_schema = require('../server/system_services/schemas/nsfs_account_schema');
const nsfs_config_schema = require('../server/system_services/schemas/nsfs_config_schema');

_.each(common_api.definitions, schema => {
    schema_utils.strictify(schema, {
        additionalProperties: false
    });
});

schema_utils.strictify(bucket_schema, {
    additionalProperties: false
});

schema_utils.strictify(account_schema, {
    additionalProperties: false
});

const validate_account = ajv.compile(account_schema);
const validate_bucket = ajv.compile(bucket_schema);
const validate_nsfs_config = ajv.compile(nsfs_config_schema);

// NOTE - DO NOT strictify nsfs_config_schema
// we might want to use it in the future for adding additional properties

/**
 * validate_account_schema validates an account object against the NC NSFS account schema
 * @param {object} account
 */
function validate_account_schema(account) {
    const valid = validate_account(account);
    if (!valid) {
        const first_err = validate_account.errors[0];
        const err_msg = first_err.message ? create_schema_err_msg(first_err) : undefined;
        throw new RpcError('INVALID_SCHEMA', err_msg);
    }
}

/**
 * validate_bucket_schema validates a bucket object against the NC NSFS bucket schema
 * @param {object} bucket
 */
function validate_bucket_schema(bucket) {
    const valid = validate_bucket(bucket);
    if (!valid) {
        const first_err = validate_bucket.errors[0];
        const err_msg = first_err.message ? create_schema_err_msg(first_err) : undefined;
        throw new RpcError('INVALID_SCHEMA', err_msg);
    }
}

/**
 * validate_nsfs_config_schema validates a config object against the NC NSFS config schema
 * @param {object} config
 */
function validate_nsfs_config_schema(config) {
    const valid = validate_nsfs_config(config);
    if (!valid) {
        const first_err = validate_nsfs_config.errors[0];
        const err_msg = first_err.message ? create_schema_err_msg(first_err) : undefined;
        throw new RpcError('INVALID_SCHEMA', err_msg);
    }
}

/**
 * create_schema_err_msg would use the original error message we got from avj
 * and adds additional info in case we have it
 * @param {object} err
 */
function create_schema_err_msg(err) {
    if (!err || !err.message) return;
    const err_msg = [err.message];
    if (err.params) err_msg.push(JSON.stringify(err.params));
    if (err.instancePath) err_msg.push(JSON.stringify(err.instancePath));
    return err_msg.join(' | ');
}

//EXPORTS
exports.validate_account_schema = validate_account_schema;
exports.validate_bucket_schema = validate_bucket_schema;
exports.validate_nsfs_config_schema = validate_nsfs_config_schema;
