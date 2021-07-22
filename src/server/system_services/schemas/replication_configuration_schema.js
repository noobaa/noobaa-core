/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    id: 'replication_configuration_schema',
    type: 'object',
    required: [
        '_id',
        'rules',
    ],
    properties: {

        // identifiers
        _id: { objectid: true },
        rules: {
            type: 'array',
            items: {
                type: 'object',
                required: ['destination_bucket', 'rule_id'],
                properties: {
                    rule_id: { type: 'string' },
                    destination_bucket: {
                        objectid: true // bucket id
                    },
                    filter: {
                        type: 'object',
                        properties: {
                            prefix: { type: 'string' },
                            // s3 support also tag or and operator of 2 tags/ tag and prefix 
                        }
                    }
                }
            }
        },
    }
};
