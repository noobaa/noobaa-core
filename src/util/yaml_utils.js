/* Copyright (C) 2016 NooBaa */
'use strict';

const yaml = require('yamljs');

function parse(yaml_string) {
    const docs = yaml_string.split(/\n\s*---\s*\n/g)
        .filter(Boolean)
        .map(yaml.parse);

    if (docs.length === 1) {
        return docs[0];
    } else {
        return {
            kind: 'List',
            apiVersion: 'v1',
            metadata: {},
            items: docs
        };
    }
}

function stringify(json) {
    if (json.kind === 'List') {
        return (json.items || [])
            .map(item => yaml.stringify(item))
            .join('---\n');

    } else {
        return yaml.strinify(json);
    }
}

exports.parse = parse;
exports.stringify = stringify;
