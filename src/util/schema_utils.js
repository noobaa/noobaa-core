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
    if (!_.isDate(val) && !_.isNumber(val)) {
        return false;
    }
    var d = new Date(val);
    return !isNaN(d.getTime());
}

function buffer_format(val) {
    return Buffer.isBuffer(val);
}

const COMMON_SCHEMA_KEYWORDS = ['doc', 'id'];

function make_strict_schema(schema, base) {
    if (!schema) return;
    if (!base) base = schema;
    if (!_.isObject(schema)) return;

    if (schema.type === 'object') {
        if (!_.isObject(schema.properties)) {
            illegal_json_schema(schema, base, 'missing properties for object type');
        }
        check_schema_extra_keywords(schema, base, ['type', 'properties', 'additionalProperties', 'required']);
        if (!('additionalProperties' in schema)) {
            schema.additionalProperties = false;
        }
        _.each(schema.properties, val => make_strict_schema(val, base));
    } else if (schema.type === 'array') {
        if (!_.isObject(schema.items)) {
            illegal_json_schema(schema, base, 'missing items for array type');
        }
        check_schema_extra_keywords(schema, base, ['type', 'items']);
        make_strict_schema(schema.items, base);
    } else if (schema.type === 'string') {
        check_schema_extra_keywords(schema, base, ['type', 'format', 'enum']);
    } else if (schema.type === 'boolean') {
        check_schema_extra_keywords(schema, base, 'type');
    } else if (schema.type === 'integer') {
        check_schema_extra_keywords(schema, base, ['type', 'format']);
    } else if (schema.type === 'number') {
        check_schema_extra_keywords(schema, base, ['type', 'format']);
    } else if (schema.format === 'buffer') {
        check_schema_extra_keywords(schema, base, 'format');
    } else if (schema.format === 'idate') {
        check_schema_extra_keywords(schema, base, 'format');
    } else if (schema.format === 'objectid') {
        check_schema_extra_keywords(schema, base, 'format');
    } else if (schema.oneOf) {
        check_schema_extra_keywords(schema, base, 'oneOf');
        _.each(schema.oneOf, val => make_strict_schema(val, base));
    } else if (schema.anyOf) {
        check_schema_extra_keywords(schema, base, 'anyOf');
        _.each(schema.anyOf, val => make_strict_schema(val, base));
    } else if (schema.allOf) {
        check_schema_extra_keywords(schema, base, 'allOf');
        _.each(schema.allOf, val => make_strict_schema(val, base));
    } else if (schema.$ref) {
        check_schema_extra_keywords(schema, base, '$ref');
    } else {
        illegal_json_schema(schema, base, 'missing type/$ref/oneOf/allOf/anyOf');
    }
}

function check_schema_extra_keywords(schema, base, keywords) {
    let remain = _.omit(schema, COMMON_SCHEMA_KEYWORDS, keywords);
    if (!_.isEmpty(remain)) {
        illegal_json_schema(schema, base, 'extra keywords in schema - ' + _.keys(remain));
    }
}

function illegal_json_schema(schema, base, error) {
    console.error('ILLEGAL JSON SCHEMA:',
        'ID: "' + base.id + '"',
        'ERROR: "' + error + '"',
        'SCHEMA:', schema,
        'BASE:', base);
    throw new Error('ILLEGAL JSON SCHEMA:' +
        'ID: "' + base.id + '"' +
        'ERROR: "' + error + '"');
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

    if (schema.format === 'buffer') {
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
