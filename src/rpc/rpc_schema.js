/* Copyright (C) 2016 NooBaa */
'use strict';


const _ = require('lodash');
const { default: Ajv } = require('ajv');
const util = require('util');
const assert = require('assert');

const dbg = require('../util/debug_module')(__filename);
const RpcError = require('./rpc_error');
const RPC_BUFFERS = require('./rpc_request').RPC_BUFFERS;
const schema_utils = require('../util/schema_utils');
const schema_keywords = require('../util/schema_keywords');

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
        this._ajv = new Ajv({ verbose: true, allErrors: true });
        this._ajv.addKeyword(schema_keywords.KEYWORDS.methods);
        this._ajv.addKeyword(schema_keywords.KEYWORDS.doc);
        this._ajv.addKeyword(schema_keywords.KEYWORDS.date);
        this._ajv.addKeyword(schema_keywords.KEYWORDS.idate);
        this._ajv.addKeyword(schema_keywords.KEYWORDS.objectid);
        this._ajv.addKeyword(schema_keywords.KEYWORDS.binary);
        if (global.window === global ||
            (process.argv[1] && process.argv[1].includes('src/test/qa'))) {
            this._ajv.addKeyword(schema_keywords.KEYWORDS.wrapper_check_only);
        } else {
            this._ajv.addKeyword(schema_keywords.KEYWORDS.wrapper);
        }

        this._client_factory = null;
        this._compiled = false;
    }


    get compiled() {
        return this._compiled;
    }

    /**

     *
     * register_api
     *
     */
    register_api(api) {
        assert(!this[api.$id], 'RPC: api already registered ' + api.$id);
        assert(!this._compiled, 'RPC: schema is already compiled');

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
        this[api.$id] = api;
    }

    compile() {
        if (this._compiled) {
            return;
        }

        _.each(this, api => {
            if (!api || !api.$id || api.$id[0] === '_') return;
            _.each(api.methods, (method_api, method_name) => {
                method_api.api = api;
                method_api.name = method_name;
                method_api.fullname = api.$id + '#/methods/' + method_name;
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
        this._generate_client_factory();
        this._compiled = true;
    }

    new_client(rpc, options) {
        assert(this._compiled, 'RPC: schema is not compiled');
        return this._client_factory(rpc, options);
    }

    _generate_client_factory() {
        const client_proto = {
            RPC_BUFFERS,

            async create_auth_token(params) {
                const res = await this.auth.create_auth(params);
                this.options.auth_token = res.token;
                return res;
            },

            async create_access_key_auth(params) {
                const res = await this.auth.create_access_key_auth(params);
                this.options.auth_token = res.token;
                return res;
            },

            async create_k8s_auth(params) {
                const res = await this.auth.create_k8s_auth(params);
                this.options.auth_token = res.token;
                return res;
            },

            _invoke_api(api, method_api, params, options) {
                options = Object.assign(
                    Object.create(this.options),
                    options
                );
                return this.rpc._request(api, method_api, params, options);
            }
        };

        for (const api of Object.values(this)) {
            if (!api || !api.$id || api.$id[0] === '_') {
                continue;
            }

            // Skip common api and other apis that do not define methods.
            if (!api.methods) {
                continue;
            }

            const name = api.$id.replace(/_api$/, '');
            if (name === 'rpc' || name === 'options') {
                throw new Error('ILLEGAL API ID');
            }

            const api_proto = {};
            for (const [method_name, method_api] of Object.entries(api.methods)) {
                // The following getter is defined as a function and not as an arrow function
                // to prevent the capture of "this" from the surrounding context.
                // When invoked, "this" should be the client object. Using an arrow function
                // will capture the "this" defined in the invocation of "_generate_client_factory"
                // which is the schema object.
                api_proto[method_name] = function(params, options) {
                    return this.client._invoke_api(api, method_api, params, options);
                };
            }

            // The following getter is defined as a function and not as an arrow function
            // on purpose. please see the last comment (above) for a detailed explanation.
            Object.defineProperty(client_proto, name, {
                enumerable: true,
                get: function() {
                    const api_instance = Object.create(api_proto);
                    api_instance.client = this;
                    return Object.freeze(api_instance);
                }
            });
        }

        this._client_factory = (rpc, options) => {
            const client = Object.create(client_proto);
            client.rpc = rpc;
            client.options = options ? Object.create(options) : {};
            return client;
        };
    }
}



module.exports = RpcSchema;
