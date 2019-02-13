/* Copyright (C) 2016 NooBaa */
'use strict';


const _ = require('lodash');
const Ajv = require('ajv');
const util = require('util');
const assert = require('assert');

const dbg = require('../util/debug_module')(__filename);
const RpcError = require('./rpc_error');
const schema_utils = require('../util/schema_utils');

const VALID_HTTP_METHODS = {
    GET: 1,
    PUT: 1,
    POST: 1,
    DELETE: 1
};

/**
 * a registry for api's
 */
class RpcSchema {

    constructor() {
        this._ajv = new Ajv({ verbose: true, schemaId: 'auto', allErrors: true });
        this._ajv.addKeyword('idate', schema_utils.KEYWORDS.idate);
        this._ajv.addKeyword('objectid', schema_utils.KEYWORDS.objectid);
        if (global.window === global) {
            this._ajv.addKeyword('wrapper', schema_utils.KEYWORDS.wrapper_check_only);
        } else {
            this._ajv.addKeyword('wrapper', schema_utils.KEYWORDS.wrapper);
        }
    }

    /**
     *
     * register_api
     *
     */
    register_api(api) {
        assert(!this[api.id], 'RPC: api already registered ' + api.id);
        _.each(api.definitions, schema => {
            schema_utils.strictify(schema, {
                additionalProperties: false
            });
        });
        _.each(api.methods, method_api => {
            schema_utils.strictify(method_api.params, {
                additionalProperties: false
            });
            schema_utils.strictify(method_api.reply, {
                additionalProperties: false
            });
        });
        try {
            this._ajv.addSchema(api);
        } catch (err) {
            dbg.error('register_api: failed compile api schema', api, err.stack || err);
            throw err;
        }
        this[api.id] = api;
    }

    compile() {
        _.each(this, api => {
            if (!api || !api.id || api.id[0] === '_') return;
            _.each(api.methods, (method_api, method_name) => {
                method_api.api = api;
                method_api.name = method_name;
                method_api.fullname = api.id + '#/methods/' + method_name;
                method_api.method = method_api.method || 'POST';
                assert(method_api.method in VALID_HTTP_METHODS,
                    'RPC: unexpected http method: ' +
                    method_api.method + ' for ' + method_api.fullname);

                try {
                    method_api.params_validator = method_api.params ?
                        this._ajv.compile({ $ref: method_api.fullname + '/params' }) :
                        schema_utils.empty_schema_validator;
                    method_api.reply_validator = method_api.reply ?
                        this._ajv.compile({ $ref: method_api.fullname + '/reply' }) :
                        schema_utils.empty_schema_validator;
                } catch (err) {
                    dbg.error('register_api: failed compile method params/reply refs',
                        method_api, err.stack || err);
                    throw err;
                }

                method_api.validate_params = (params, desc) => {
                    let result = method_api.params_validator(params);
                    if (!result) {
                        dbg.error('INVALID_SCHEMA_PARAMS', desc, method_api.fullname,
                            'ERRORS:', util.inspect(method_api.params_validator.errors, true, null, true),
                            'PARAMS:', util.inspect(params, true, null, true));
                        throw new RpcError('INVALID_SCHEMA_PARAMS', `INVALID_SCHEMA_PARAMS ${desc} ${method_api.fullname}`);
                    }
                };

                method_api.validate_reply = (reply, desc) => {
                    let result = method_api.reply_validator(reply);
                    if (!result) {
                        dbg.error('INVALID_SCHEMA_REPLY', desc, method_api.fullname,
                            'ERRORS:', util.inspect(method_api.reply_validator.errors, true, null, true),
                            'REPLY:', util.inspect(reply, true, null, true));
                        throw new RpcError('INVALID_SCHEMA_REPLY', `INVALID_SCHEMA_REPLY ${desc} ${method_api.fullname}`);
                    }
                };
            });
        });
    }
}



module.exports = RpcSchema;
