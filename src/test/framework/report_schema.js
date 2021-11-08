/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 'test_report_schema',
    type: 'object',
    required: [
        'date',
        'suit_name',
        'conf',
        'env',
        'results'
    ],
    properties: {
        date: {
            type: 'date'
        },
        suite_name: {
            type: 'string'
        },
        conf: {
            type: 'object',
            properties: {},
            additionalProperties: true
        },
        env: {
            type: 'object',
            properties: {},
            additionalProperties: true
        },
        results: {
            type: 'object',
            properties: {
                passed_cases: {
                    type: 'number'
                },
                failed_cases: {
                    type: 'number'
                },
            },
        }
    }
};
