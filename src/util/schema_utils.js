'use strict';

var _ = require('lodash');

module.exports = {
    idate_format: idate_format,
    strictify: strictify,
    empty_schema_validator: empty_schema_validator,
    generate_schema_export_buffers: generate_schema_export_buffers,
    generate_schema_import_buffers: generate_schema_import_buffers,
};

function idate_format(val) {
    if (!_.isDate(val) && !_.isNumber(val)) {
        return false;
    }
    var d = new Date(val);
    return !isNaN(d.getTime());
}

const COMMON_SCHEMA_KEYWORDS = ['doc', 'id'];

function strictify(schema, options, base) {
    if (!schema) return schema;
    if (!base) base = schema;
    if (!_.isObject(schema)) return schema;

    if (schema.type === 'object') {
        if (!_.isObject(schema.properties)) {
            illegal_json_schema(schema, base, 'missing properties for object type');
        }
        check_schema_extra_keywords(schema, base, [
            'type', 'properties', 'additionalProperties', 'required'
        ]);
        if (options &&
            'additionalProperties' in options &&
            !('additionalProperties' in schema)) {
            schema.additionalProperties = options.additionalProperties;
        }
        _.each(schema.properties, val => {
            strictify(val, options, base);
        });
    } else if (schema.type === 'array') {
        if (!_.isObject(schema.items)) {
            illegal_json_schema(schema, base, 'missing items for array type');
        }
        check_schema_extra_keywords(schema, base, ['type', 'items']);
        strictify(schema.items, options, base);
    } else if (schema.type === 'string') {
        check_schema_extra_keywords(schema, base, ['type', 'format', 'enum']);
    } else if (schema.type === 'boolean') {
        check_schema_extra_keywords(schema, base, 'type');
    } else if (schema.type === 'integer') {
        check_schema_extra_keywords(schema, base, ['type', 'format']);
    } else if (schema.type === 'number') {
        check_schema_extra_keywords(schema, base, ['type', 'format']);
    } else if (schema.buffer) {
        check_schema_extra_keywords(schema, base, 'buffer');
    } else if (schema.format === 'idate') {
        check_schema_extra_keywords(schema, base, 'format');
    } else if (schema.format === 'objectid') {
        check_schema_extra_keywords(schema, base, 'format');
    } else if (schema.oneOf) {
        check_schema_extra_keywords(schema, base, 'oneOf');
        _.each(schema.oneOf, val => {
            strictify(val, options, base);
        });
    } else if (schema.anyOf) {
        check_schema_extra_keywords(schema, base, 'anyOf');
        _.each(schema.anyOf, val => {
            strictify(val, options, base);
        });
    } else if (schema.allOf) {
        check_schema_extra_keywords(schema, base, 'allOf');
        _.each(schema.allOf, val => {
            strictify(val, options, base);
        });
    } else if (schema.$ref) {
        check_schema_extra_keywords(schema, base, '$ref');
    } else if (schema.type === 'null') {
        check_schema_extra_keywords(schema, base, 'type');
    } else {
        illegal_json_schema(schema, base,
            'strictify: missing type/$ref/oneOf/allOf/anyOf');
    }
    return schema;
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
    throw new Error('ILLEGAL JSON SCHEMA: ' +
        'ID: "' + base.id + '" ' +
        'ERROR: "' + error + '" ');
}


function empty_schema_validator(json) {
    if (_.isEmpty(json)) {
        return true;
    } else {
        empty_schema_validator.errors = "expected empty schema";
        return false;
    }
}


// generating functions to extract/combine the buffers from objects
//
// NOTE: this code only supports buffers under predefined properties
// so can't use array of buffers or a additionalProperties which is not listed
// in schema.properties while this preparation code runs.
//
// create a concatenated buffer from all the buffers
// and replace each of the original paths with the buffer length
function generate_schema_export_buffers(buffer_paths) {
    let code = `
            var buffers = [];
            var buf;
    `;
    for (const buf_path of buffer_paths) {
        code += `
            buf = data${buf_path};
            if (buf) {
                buffers.push(buf);
                data${buf_path} = buf.length;
            }
        `;
    }
    code += `
            return buffers;
    `;
    /* jslint evil: true */
    // eslint-disable-next-line no-new-func
    return new Function('data', code);
}

function generate_schema_import_buffers(buffer_paths) {
    let code = `
            var start = 0;
            var end = 0;
            var len;
            buf = buf || new Buffer(0);
    `;
    for (const buf_path of buffer_paths) {
        code += `
            len = data${buf_path};
            if (typeof(len) === "number") {
                start = end;
                end = start + len;
                data${buf_path} = buf.slice(start, end);
            }
        `;
    }
    /* jslint evil: true */
    // eslint-disable-next-line no-new-func
    return new Function('data', 'buf', code);
}
