/* Copyright (C) 2023 NooBaa */
'use strict';

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

schema_utils.strictify(bucket_schema, {
    additionalProperties: false
});

schema_utils.strictify(account_schema, {
    additionalProperties: false
});

// NOTE - DO NOT strictify nsfs_config_schema
// we might want to use it in the future for adding additional properties

function validate_account_schema(account) {
    const valid = ajv.validate(account_schema, account);
    if (!valid) throw new RpcError('INVALID_SCHEMA', ajv.errors[0]?.message);
}

function validate_bucket_schema(bucket) {
    const valid = ajv.validate(bucket_schema, bucket);
    if (!valid) throw new RpcError('INVALID_SCHEMA', ajv.errors[0]?.message);
}

function validate_nsfs_config_schema(config) {
    const valid = ajv.validate(nsfs_config_schema, config);
    if (!valid) throw new RpcError('INVALID_SCHEMA', ajv.errors[0]?.message);
}

//EXPORTS
exports.validate_account_schema = validate_account_schema;
exports.validate_bucket_schema = validate_bucket_schema;
exports.validate_nsfs_config_schema = validate_nsfs_config_schema;
