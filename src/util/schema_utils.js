'use strict';

var _ = require('lodash');
var genfun = require('generate-function');

module.exports = {
    idate_format: idate_format,
    buffer_format: buffer_format,
    make_strict_schema: make_strict_schema,
    empty_schema_validator: empty_schema_validator,
    prepare_buffers_in_schema: prepare_buffers_in_schema,
};

function idate_format(val) {
    var d = new Date(val);
    return !isNaN(d.getTime());
}

function buffer_format(val) {
    return Buffer.isBuffer(val);
}


function make_strict_schema(schema, base) {
    if (!schema) return;
    if (!base) base = schema;
    if (!_.isObject(schema)) return;
    if (schema.type) {
        if (schema.type === 'object') {
            if (!('additionalProperties' in schema)) {
                schema.additionalProperties = false;
            }
            _.each(schema.properties, val => make_strict_schema(val, base));
        } else if (schema.type === 'array') {
            make_strict_schema(schema.items, base);
        }
    } else if (schema.oneOf) {
        _.each(schema.oneOf, val => make_strict_schema(val, base));
    } else if (schema.anyOf) {
        _.each(schema.anyOf, val => make_strict_schema(val, base));
    } else if (schema.allOf) {
        _.each(schema.allOf, val => make_strict_schema(val, base));
    } else if (schema.$ref) {
        // noop
    } else if (schema.format) {
        // noop
    } else if (schema.enum) {
        // noop
    } else {
        console.error('ILLEGAL JSON SCHEMA, missing type/$ref/oneOf/allOf/anyOf',
            'schema', schema, 'base', base);
        throw new Error('ILLEGAL JSON SCHEMA ' + base.id);
    }
}

function empty_schema_validator(json) {
    if (_.isEmpty(json)) {
        return true;
    } else {
        empty_schema_validator.errors = "expected empty schema";
        return false;
    }
}


function prepare_buffers_in_schema(schema, base, path) {
    if (!schema) return;
    if (!base) {
        base = schema;
        path = [];
    }

    if (schema.type === 'buffer') {
        delete schema.type;
        delete schema.additionalProperties;
        schema.format = 'buffer';
        base.buffers = base.buffers || [];
        base.buffers.push({
            path: path,
            jspath: _.map(path, item => '["' + item + '"]').join('')
        });
    } else if (schema.type === 'object') {
        _.each(schema.properties, (val, key) => {
            if (!val) return;
            prepare_buffers_in_schema(val, base, path.concat(key));
        });
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
            _.each(base.buffers, b => {
                efn('buf = obj%s;', b.jspath);
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
            _.each(base.buffers, (b, i) => {
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
