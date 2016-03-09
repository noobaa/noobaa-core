'use strict';


let _ = require('lodash');
let assert = require('assert');
let Ajv = require('ajv');
let dbg = require('../util/debug_module')(__filename);
let schema_utils = require('../util/schema_utils');

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
        this._ajv = new Ajv({
            formats: {
                idate: schema_utils.idate_format,
                buffer: schema_utils.buffer_format
            },
        });
    }

    /**
     *
     * register_api
     *
     */
    register_api(api) {
        assert(!this[api.id], 'RPC: api already registered ' + api.id);
        _.each(api.definitions, schema => {
            schema_utils.make_strict_schema(schema);
            schema_utils.prepare_buffers_in_schema(schema);
        });
        _.each(api.methods, method_api => {
            schema_utils.make_strict_schema(method_api.params);
            schema_utils.make_strict_schema(method_api.reply);
            schema_utils.prepare_buffers_in_schema(method_api.params);
            schema_utils.prepare_buffers_in_schema(method_api.reply);
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
                        this._ajv.compile({
                            $ref: method_api.fullname + '/params'
                        }) : schema_utils.empty_schema_validator;
                    method_api.reply_validator = method_api.reply ?
                        this._ajv.compile({
                            $ref: method_api.fullname + '/reply'
                        }) : schema_utils.empty_schema_validator;
                } catch (err) {
                    dbg.error('register_api: failed compile method params/reply refs',
                        method_api, err.stack || err);
                    throw err;
                }

                method_api.validate_params = (params, desc) => {
                    let result = method_api.params_validator(params);
                    if (!result) {
                        dbg.error('INVALID SCHEMA', desc, 'PARAMS', method_api.fullname,
                            'ERRORS:', method_api.params_validator.errors,
                            'PARAMS:', params);
                        throw new Error('INVALID SCHEMA ' + desc + ' PARAMS ' +
                            method_api.fullname);
                    }
                };

                method_api.validate_reply = (reply, desc) => {
                    let result = method_api.reply_validator(reply);
                    if (!result) {
                        dbg.error('INVALID SCHEMA', desc, 'REPLY', method_api.fullname,
                            'ERRORS:', method_api.reply_validator.errors,
                            'REPLY:', reply);
                        throw new Error('INVALID SCHEMA ' + desc + ' REPLY ' +
                            method_api.fullname);
                    }
                };
            });
        });
    }
}



module.exports = RpcSchema;
