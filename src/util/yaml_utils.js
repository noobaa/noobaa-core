/* Copyright (C) 2016 NooBaa */
'use strict';

const yaml = require('yamljs');

function parse(yaml_string, forceListResult = false) {
    const docs = yaml_string.split(/\n\s*---\s*\n/g)
        .filter(Boolean)
        .map(yaml.parse);

    if (forceListResult || docs.length !== 1) {
        return {
            kind: 'List',
            apiVersion: 'v1',
            metadata: {},
            items: docs
        };
    } else {
        return docs[0];
    }
}

function stringify(json) {
    const docs =
        (!json && []) ||
        (Array.isArray(json) && json) ||
        (json.kind === 'List' && (json.items || [])) ||
        [json];

    return docs
        .map(doc => yaml.stringify(doc))
        .join('---\n');
}

exports.parse = parse;
exports.stringify = stringify;
