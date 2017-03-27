/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    id: 's3_usage_schema',
    type: 'object',
    required: ['system'],
    properties: {
        system: {
            format: 'objectid'
        },
        s3_usage_info: {
            type: 'object',
            patternProperties: {
                ".+": {
                    type: 'integer'
                }
            }
        },
        s3_errors_info: {
            type: 'object',
            patternProperties: {
                ".+": {
                    type: 'integer'
                }
            }
        }
    }
};
