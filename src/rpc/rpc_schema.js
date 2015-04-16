'use strict';

var _ = require('lodash');
var assert = require('assert');
var tv4 = require('tv4');
var dbg = require('noobaa-util/debug_module')(__filename);

module.exports = RpcSchema;

/**
 * a registry for api's
 */
function RpcSchema() {
    this._schemas = tv4.freshApi();
    this._schemas.addFormat('date', function(data) {
        var d = new Date(data);
        return isNaN(d.getTime()) ? 'bad date' : null;
    });
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
        self._schemas.addSchema('/' + api.name + '/definitions/' + name, schema);
    });

    // add all definitions
    _.each(api.definitions, function(schema, name) {
        self._schemas.addSchema('/' + api.name + '/definitions/' + name, schema);
    });

    // go over the api and check its validity
    _.each(api.methods, function(method_api, method_name) {
        // add the name to the info
        method_api.name = method_name;
        method_api.fullname = '/' + api.name + '/methods/' + method_name;
        method_api.params_schema = method_api.fullname + '/params';
        method_api.reply_schema = method_api.fullname + '/reply';

        self._schemas.addSchema(method_api.params_schema, method_api.params || {});
        self._schemas.addSchema(method_api.reply_schema, method_api.reply || {});
        method_api.params_properties = self._schemas.getSchema(method_api.params_schema).properties;

        assert(method_api.method in VALID_HTTP_METHODS,
            'RPC: unexpected http method: ' +
            method_api.method + ' for ' + method_api.fullname);

        method_api.validate_params = function(params, desc) {
            var params_to_validate = method_api.param_raw ?
                _.omit(params, method_api.param_raw) :
                params;
            var result = self._schemas.validateResult(
                params,
                method_api.params_schema,
                true /*checkRecursive*/ ,
                true /*banUnknownProperties*/
            );

            if (!result.valid) {
                dbg.error('INVALID PARAMS SCHEMA', desc, method_api.params_schema, params);
                result.desc = desc;
                throw result;
            }
        };

        method_api.validate_reply = function(reply, desc) {
            if (method_api.reply_raw) {
                return;
            }
            var result = self._schemas.validateResult(
                reply,
                method_api.reply_schema,
                true /*checkRecursive*/ ,
                true /*banUnknownProperties*/
            );

            if (!result.valid) {
                dbg.error('INVALID REPLY SCHEMA', desc, method_api.reply_schema, reply);
                result.desc = desc;
                throw result;
            }
        };
    });

    self[api.name] = api;

    return api;
};
