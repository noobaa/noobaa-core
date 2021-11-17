/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 's3_usage_schema',
    type: 'object',
    required: ['system', 's3_usage_info', 's3_errors_info'],
    properties: {
        _id: {
            objectid: true
        },
        system: {
            objectid: true
        },
        s3_usage_info: {
            type: 'object',
            additionalProperties: {
                type: 'integer'
            }
        },
        s3_errors_info: {
            type: 'object',
            additionalProperties: {
                type: 'integer'
            }
        }
    }
};
