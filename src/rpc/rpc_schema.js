'use strict';

var _ = require('lodash');
var assert = require('assert');
var validator = require('is-my-json-valid');
var dbg = require('noobaa-util/debug_module')(__filename);

module.exports = RpcSchema;

/**
 * a registry for api's
 */
function RpcSchema() {
    this._schemas = {};
    this._validator_options = {
        schemas: this._schemas,
        verbose: true,
        formats: {
            idate: function(val) {
                var d = new Date(val);
                return !isNaN(d.getTime());
            },
            buffer: function(val) {
                return Buffer.isBuffer(val);
            }
        },
        // TODO banUnknownProperties is pending issue
        // https://github.com/mafintosh/is-my-json-valid/issues/59
        banUnknownProperties: true
    };
}

var VALID_HTTP_METHODS = {
    GET: 1,
    PUT: 1,
    POST: 1,
    DELETE: 1
};

/**
 *
 * register_api
 *
 */
RpcSchema.prototype.register_api = function(api) {
    var self = this;

    assert(!self[api.name], 'RPC: api already registered ' + api.name);

    // add all definitions
    _.each(api.definitions, function(schema, name) {
        schema.id = '/' + api.name + '/definitions/' + name;
        self._schemas[schema.id] = schema;
    });

    // go over the api and check its validity
    _.each(api.methods, function(method_api, method_name) {
        // add the name to the info
        method_api.name = method_name;
        method_api.fullname = '/' + api.name + '/methods/' + method_name;
        method_api.params = method_api.params || {};
        method_api.reply = method_api.reply || {};
        method_api.params_validator = validator(method_api.params, self._validator_options);
        method_api.reply_validator = validator(method_api.reply, self._validator_options);
        method_api.params_properties = method_api.params.properties;

        assert(method_api.method in VALID_HTTP_METHODS,
            'RPC: unexpected http method: ' +
            method_api.method + ' for ' + method_api.fullname);

        method_api.validate_params = function(params, desc) {
            var result = method_api.params_validator(params);
            if (!result) {
                dbg.error('INVALID PARAMS SCHEMA',
                    desc, method_api.fullname, params,
                    method_api.params_validator.errors);
                throw new Error('INVALID PARAMS SCHEMA ' + desc + ' ' + method_api.fullname);
            }
        };

        method_api.validate_reply = function(reply, desc) {
            var result = method_api.reply_validator(reply);
            if (!result) {
                dbg.error('INVALID REPLY SCHEMA',
                    desc, method_api.fullname, reply,
                    method_api.params_validator.errors);
                throw new Error('INVALID REPLY SCHEMA ' + desc + ' ' + method_api.fullname);
            }
        };
    });

    self[api.name] = api;

    return api;
};
