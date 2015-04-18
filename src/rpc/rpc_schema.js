'use strict';

var _ = require('lodash');
var assert = require('assert');
var validator = require('is-my-json-valid');
var genfun = require('generate-function');
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
        prepare_schema(schema);
        self._schemas[schema.id] = schema;
    });

    // go over the api and check its validity
    _.each(api.methods, function(method_api, method_name) {
        // add the name to the info
        method_api.name = method_name;
        method_api.fullname = '/' + api.name + '/methods/' + method_name;
        method_api.params = method_api.params || {};
        method_api.reply = method_api.reply || {};
        method_api.params.id = method_api.fullname + '/params';
        method_api.reply.id = method_api.fullname + '/reply';
        prepare_schema(method_api.params);
        prepare_schema(method_api.reply);
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


function prepare_schema(base, schema, path) {
    if (!schema) {
        schema = base;
        path = [];
    }
    if (schema.type === 'buffer') {
        delete schema.type;
        delete schema.additionalProperties;
        schema.format = 'buffer';
        base.buffers = base.buffers || [];
        base.buffers.push({
            path: path,
            jspath: _.map(path, function(item) {
                return '["' + item + '"]';
            }).join('')
        });
    } else if (schema.type === 'array') {
        if (schema.items) {
            prepare_schema(base, schema.items, path.concat('[]'));
        }
    } else if (schema.type === 'object') {
        // TODO this is a temporary way to support banUnknownProperties - see above
        if (!('additionalProperties' in schema)) {
            schema.additionalProperties = false;
        }
        _.each(schema.properties, function(val, key) {
            if (!val) return;
            prepare_schema(base, val, path.concat(key));
        });
    }
    if (schema === base) {
        /**
         * generating functions to extract/combine the buffers from objects
         *
         * @param req the wrapping object holding the params/reply
         * @param root either 'params' or 'reply'
         *
         * NOTE: this code only supports buffers under predefined properties
         * so can't use array of buffers or a additionalProperties which is not listed
         * in schema.properties while this preparation code runs.
         */
        var efn = genfun()
            ('function export_buffers(req, root) {');
        if (base.buffers) {
            // create a concatenated buffer from all the buffers
            efn('req.buffers = [');
            _.each(base.buffers, function(b) {
                efn('req[root]%s , ', b.jspath);
            });
            efn('];');
            efn('req.buffers_len = ');
            _.each(base.buffers, function(b) {
                efn('req[root]%s.length + ', b.jspath);
            });
            efn('0;');
            // replace each of the original paths with the buffer length
            _.each(base.buffers, function(b) {
                efn('req[root]%s = req[root]%s.length;', b.jspath, b.jspath);
            });
        }
        base.export_buffers = efn('}').toFunction();
        // the import_buffers counterpart
        var ifn = genfun()
            ('function import_buffers(req, root) {');
        _.each(base.buffers, function(b, i) {
            // verify the buffer length matches before replacing
            ifn('if (req[root]%s !== req.buffers[%d].length)', b.jspath, i);
            ifn('  throw new Error("LENGTH MISMATCH IMPORT BUFFER %d");', i);
            ifn('req[root]%s = req.buffers[%d];', b.jspath, i);
        });
        base.import_buffers = ifn('}').toFunction();
        if (base.buffers) {
            dbg.log0('SCHEMA BUFFERS', base.id, base.buffers,
                base.export_buffers.toString(),
                base.import_buffers.toString());
        }
    }
}
