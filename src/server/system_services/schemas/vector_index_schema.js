/* Copyright (C) 2026 NooBaa */
'use strict';

const SensitiveString = require('../../../util/sensitive_string');

module.exports = {
    $id: 'vector_index_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'name',
        'vector_bucket',
        'distance_metric',
        'dimension'
    ],
    properties: {
        _id: {
            objectid: true
        },
        system: {
            objectid: true
        },
        name: {
            wrapper: SensitiveString,
        },
        vector_bucket: {
            objectid: true,
        },
        dimension: {
            type: 'integer',
            minimum: 1,
        },
        distance_metric: {
            type: 'string',
            enum: ['cosine', 'euclidean']
        },
        data_type: {
            type: 'string',
            enum: ['float32']
        },
        metadataConfiguration: {
            type: 'object',
            properties: {
                nonFilterableMetadataKeys: {
                    type: 'array',
                    items: {
                        type: 'string'
                    },
                }
            }
        },
        owner_account: {
            objectid: true
        },
        creation_time: {
            idate: true
        },
        tags: {
            $ref: 'common_api#/definitions/tagging',
        },
        deleted: {
            date: true
        },
    }
};
