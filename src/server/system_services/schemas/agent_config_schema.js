/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 'agent_config_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'name'
    ],
    properties: {
        _id: {
            objectid: true
        },
        system: {
            objectid: true
        },
        name: {
            type: 'string'
        },
        pool: {
            objectid: true
        },
        exclude_drives: {
            type: 'array',
            items: {
                type: 'string'
            }
        },
        use_storage: {
            type: 'boolean'
        },
        routing_hint: {
            type: 'string',
            enum: ['INTERNAL', 'EXTERNAL']
        }
    }
};
