/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');

const COMMON_SCHEMA_KEYWORDS = ['doc', '$id'];
const object_id_regexp = /^[0-9a-fA-F]{24}$/;

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
        check_schema_extra_keywords(schema, base, ['type', 'format', 'minimum', 'maximum']);
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

function is_object_id_class(id) {
    return (id && id.constructor && id.constructor.name === 'ObjectID');
}

function is_object_id_string(id) {
    return object_id_regexp.test(id);
}

function is_object_id(id) {
    switch (typeof id) {
        case 'object':
            return is_object_id_class(id);
        case 'string':
            return is_object_id_string(id);
        default:
            return false;
    }
}

exports.strictify = strictify;
exports.empty_schema_validator = empty_schema_validator;
exports.is_object_id_class = is_object_id_class;
exports.is_object_id_string = is_object_id_string;
exports.is_object_id = is_object_id;
