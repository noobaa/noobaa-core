/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');
const js_utils = require('./js_utils');
const crypto = require('crypto');

const KEYWORDS = js_utils.deep_freeze({

    // schema: { date: true } will match (new Date())
    date: {
        errors: false,
        statements: true,
        inline: (it, keyword, schema, parent) => {
            const v = `valid${it.level}`;
            const d = `data${it.dataLevel || ''}`;
            return `
                ${v} = (${d} instanceof Date);
            `;
        }
    },

    // schema: { idate: true } will match (new Date()).getTime()
    idate: {
        errors: false,
        statements: true,
        inline: (it, keyword, schema, parent) => {
            const v = `valid${it.level}`;
            const d = `data${it.dataLevel || ''}`;
            // TODO: Remove accepting instanceof Date after converting all uses of
            // idates in the database schema into the date format (currently most of them are
            // already saved in ISO format which is not idate)
            return `
                if (${d} instanceof Date) {
                    ${v} = true;
                } else {
                    ${v} = Number.isInteger(${d}) && !isNaN((new Date(${d})).getTime());
                }
            `;
        }
    },

    // schema: { objectid: true } will match (new mongodb.ObjectId()) or (new mongodb.ObjectId()).valueOf()
    objectid: {
        errors: false,
        statements: true,
        inline: (it, keyword, schema, parent) => {
            const v = `valid${it.level}`;
            const d = `data${it.dataLevel || ''}`;
            return `
                switch (typeof ${d}) {
                    case 'object':
                        ${v} = (${d} && ${d}.constructor && ${d}.constructor.name === 'ObjectID');
                        break;
                    case 'string':
                        ${v} = /^[0-9a-fA-F]{24}$/.test(${d});
                        break;
                    default:
                        ${v} = false;
                        break;
                }
            `;
        }
    },

    // schema: { binary: 64 } will match Buffer.alloc(64)
    // schema: { binary: true } will match Buffer.alloc(<any>)
    binary: {
        errors: false,
        statements: true,
        inline: (it, keyword, schema, parent) => {
            const v = `valid${it.level}`;
            const d = `data${it.dataLevel || ''}`;
            const is_bson = `(${d}._bsontype === 'Binary')`;
            const is_buf = `(Buffer.isBuffer(${d}))`;
            const bson_len = `(${d}.length() === ${schema})`;
            const buf_len = `(${d}.length === ${schema})`;
            if (typeof schema === 'number') {
                return `
                    ${v} = ${d} && ((${is_bson} && ${bson_len}) || (${is_buf} && ${buf_len}));
                `;
            } else {
                return `
                    ${v} = ${d} && (${is_bson} || ${is_buf});
                `;
            }
        }
    },

    wrapper: {
        errors: false,
        statements: true,
        modifying: true,
        inline: (it, keyword, schema, parent) => {
            if (it.dataLevel <= 0) return;
            const valid = `valid${it.level}`;
            const val = `data${it.dataLevel || ''}`;
            const obj = `data${(it.dataLevel - 1) || ''}`;
            const key = it.dataPathArr[it.dataLevel];
            const field = `${obj}[${key}]`;
            const wrapper = `validate.schema${it.schemaPath}.${keyword}`;
            return `
            if (${val} instanceof ${wrapper}) {
                ${valid} = true;
            } else if (${wrapper}.can_wrap(${val})) {
                ${valid} = true;
                ${field} = new ${wrapper}(${val});
            } else {
                ${valid} = false;
            }
        `;
        }
    },

    wrapper_check_only: {
        errors: false,
        statements: true,
        inline: (it, keyword, schema, parent) => {
            if (it.dataLevel <= 0) return;
            const valid = `valid${it.level}`;
            const val = `data${it.dataLevel || ''}`;
            const wrapper = `validate.schema${it.schemaPath}.${keyword}`;
            return `
            if (${wrapper}.can_wrap(${val})) {
                ${valid} = true;
            } else {
                ${valid} = false;
            }
        `;
        }
    }

});

class SensitiveString {
    constructor(val) {
        const md5 = crypto.createHash('md5');
        if (val instanceof SensitiveString) {
            this.val = val.unwrap();
        } else {
            this.val = val;
        }
        md5.update(this.val);
        this.md5 = md5.digest('hex');
    }

    [util.inspect.custom]() {
        return 'SENSITIVE' + this.md5;
    }

    toString() {
        return 'SENSITIVE' + this.md5;
    }

    toJSON() {
        return this.val;
    }

    toBSON() {
        return this.val;
    }

    valueOf() {
        return this.val;
    }

    unwrap() {
        return this.val;
    }

    static can_wrap(val) {
        return typeof val === 'string';
    }

}

const COMMON_SCHEMA_KEYWORDS = ['doc', 'id'];

function strictify(schema, options, base) {
    if (!schema) return schema;
    if (!base) base = schema;
    if (!_.isObject(schema)) return schema;

    if (schema.type === 'object') {
        if (!_.isObject(schema.properties) && !_.isObject(schema.patternProperties) && !_.isObject(schema.additionalProperties)) {
            illegal_json_schema(schema, base, 'missing properties for object type');
        }
        check_schema_extra_keywords(schema, base, [
            'type', 'properties', 'additionalProperties', 'patternProperties', 'required', 'wrapper'
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
        check_schema_extra_keywords(schema, base, ['type', 'format', 'enum', 'wrapper']);
    } else if (schema.type === 'boolean') {
        check_schema_extra_keywords(schema, base, 'type');
    } else if (schema.type === 'integer') {
        check_schema_extra_keywords(schema, base, ['type', 'format']);
    } else if (schema.type === 'number') {
        check_schema_extra_keywords(schema, base, ['type', 'format', 'minimum', 'maximum']);
    } else if (schema.date) {
        check_schema_extra_keywords(schema, base, 'date');
    } else if (schema.idate) {
        check_schema_extra_keywords(schema, base, 'idate');
    } else if (schema.objectid) {
        check_schema_extra_keywords(schema, base, 'objectid');
    } else if (schema.binary) {
        check_schema_extra_keywords(schema, base, 'binary');
    } else if (schema.wrapper) {
        check_schema_extra_keywords(schema, base, 'wrapper');
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
    } else if (schema.additionalProperties) {
        check_schema_extra_keywords(schema, base, 'additionalProperties');
        strictify(schema.additionalProperties, options, base);
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
        'SCHEMA:', util.inspect(schema, true, null, true),
        'BASE:', util.inspect(base, true, null, true));
    throw new Error('ILLEGAL JSON SCHEMA: ' +
        'ID: "' + base.id + '" ' +
        'ERROR: "' + error + '" ');
}


function empty_schema_validator(json) {
    if (_.isEmpty(json)) return true;
    empty_schema_validator.errors = "expected empty schema";
    return false;
}

exports.KEYWORDS = KEYWORDS;
exports.SensitiveString = SensitiveString;
exports.strictify = strictify;
exports.empty_schema_validator = empty_schema_validator;
