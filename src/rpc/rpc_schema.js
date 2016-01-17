'use strict';

module.exports = RpcSchema;

var _ = require('lodash');
var assert = require('assert');
var Ajv = require('ajv');
var genfun = require('generate-function');
var dbg = require('../util/debug_module')(__filename);

/**
 * a registry for api's
 */
function RpcSchema() {
    this._schemas = {};
    this._validator = new Ajv({
        missingRefs: 'ignore',
        // verbose: true,
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
        schema.id = '/' + api.name + '/definitions/' + name;
        prepare_schema(schema);
        try {
            self._validator.addSchema(schema);
        } catch (err) {
            dbg.error('register_api: failed compile definition schema',
                schema, err.stack || err);
            throw err;
        }
    });

    // go over the api and check its validity
    _.each(api.methods, function(method_api, method_name) {
        // add the name to the info
        method_api.api = api;
        method_api.name = method_name;
        method_api.fullname = '/' + api.name + '/methods/' + method_name;

        if (method_api.params) {
            method_api.params.id = method_api.fullname + '/params';
            prepare_schema(method_api.params);
            try {
                method_api.params_validator = self._validator.compile(method_api.params);
            } catch (err) {
                dbg.error('register_api: failed compile params schema',
                    method_api.params, err.stack || err);
                throw err;
            }
        } else {
            method_api.params_validator = validator_of_empty_schema;
        }

        if (method_api.reply) {
            method_api.reply.id = method_api.fullname + '/reply';
            prepare_schema(method_api.reply);
            try {
                method_api.reply_validator = self._validator.compile(method_api.reply);
            } catch (err) {
                dbg.error('register_api: failed compile reply schema',
                    method_api.reply, err.stack || err);
                throw err;
            }
        } else {
            method_api.reply_validator = validator_of_empty_schema;
        }

        method_api.method = method_api.method || 'POST';
        assert(method_api.method in VALID_HTTP_METHODS,
            'RPC: unexpected http method: ' +
            method_api.method + ' for ' + method_api.fullname);

        method_api.validate_params = function(params, desc) {
            var result = method_api.params_validator(params);
            if (!result) {
                dbg.error('INVALID PARAMS SCHEMA', desc, method_api.fullname,
                    'ERRORS:', method_api.params_validator.errors,
                    'PARAMS:', params);
                throw new Error('INVALID PARAMS SCHEMA ' + desc + ' ' + method_api.fullname);
            }
        };

        method_api.validate_reply = function(reply, desc) {
            var result = method_api.reply_validator(reply);
            if (!result) {
                dbg.error('INVALID REPLY SCHEMA', desc, method_api.fullname,
                    'ERRORS:', method_api.reply_validator.errors,
                    'REPLY:', reply);
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
        // this is a temporary way to support banUnknownProperties - see above
        if (!('additionalProperties' in schema)) {
            schema.additionalProperties = false;
        }
        _.each(schema.properties, function(val, key) {
            if (!val) return;
            prepare_schema(base, val, path.concat(key));
        });
    } else if (!schema.type &&
        !schema.$ref &&
        !schema.oneOf &&
        !schema.allOf &&
        !schema.anyOf) {
        console.error('RPC SCHEMA illegal schema, missing type/$ref/oneOf/anyOf',
            base.id, 'path', path.join('.'), 'schema', JSON.stringify(schema));
        throw new Error('RPC SCHEMA illegal schema ' + base.id);
    }

    if (schema === base) {
        /**
         * generating functions to extract/combine the buffers from objects
         *
         * @param req the wrapping object holding the params/reply
         * @param head either 'params' or 'reply'
         *
         * NOTE: this code only supports buffers under predefined properties
         * so can't use array of buffers or a additionalProperties which is not listed
         * in schema.properties while this preparation code runs.
         */
        var efn = genfun()('function export_buffers(obj) {');
        if (base.buffers) {
            // create a concatenated buffer from all the buffers
            // and replace each of the original paths with the buffer length
            efn('var buffers = [];');
            efn('var buf;');
            _.each(base.buffers, function(b) {
                efn('var buf = obj%s;', b.jspath);
                efn('if (buf) {');
                efn(' buffers.push(buf);');
                efn(' obj%s = buf.length;', b.jspath);
                efn('}');
            });
            efn('return buffers;');
        }
        base.export_buffers = efn('}').toFunction();

        // the import_buffers counterpart
        var ifn = genfun()('function import_buffers(obj, data) {');
        if (base.buffers) {
            ifn('var start = 0;');
            ifn('var end = 0;');
            ifn('var len;');
            ifn('data = data || new Buffer(0);');
            _.each(base.buffers, function(b, i) {
                ifn('len = obj%s;', b.jspath);
                ifn('if (typeof(len) === "number") {');
                ifn(' start = end;');
                ifn(' end = start + len;');
                ifn(' obj%s = data.slice(start, end);', b.jspath);
                ifn('}');
            });
        }
        base.import_buffers = ifn('}').toFunction();
        if (base.buffers) {
            // dbg.log1('SCHEMA BUFFERS', base.id, base.buffers,
            // base.export_buffers.toString(),
            // base.import_buffers.toString());
        }
    }
}

function validator_of_empty_schema(json) {
    if (_.isEmpty(json)) {
        return true;
    } else {
        validator_of_empty_schema.errors = "expected empty schema";
        return false;
    }
}
