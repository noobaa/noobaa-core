/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    id: 'agent_config_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'name'
    ],
    properties: {
        _id: {
            format: 'objectid'
        },
        system: {
            format: 'objectid'
        },
        name: {
            type: 'string'
        },
        pool: {
            format: 'objectid'
        },
        exclude_drive: {
            type: 'array',
            items: {
                type: 'string'
            }
        },
        use_storage: {
            type: 'boolean'
        },
        use_s3: {
            type: 'boolean'
        }
    }
};
