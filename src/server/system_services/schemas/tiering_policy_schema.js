/* Copyright (C) 2016 NooBaa */
'use strict';

const SensitiveString = require('../../../util/sensitive_string');

module.exports = {
    $id: 'tiering_policy_schema',
    type: 'object',
    required: [
        '_id',
        'name',
        'system',
        'chunk_split_config',
        'tiers',
    ],
    properties: {

        // identifiers
        _id: { objectid: true },
        name: { wrapper: SensitiveString },
        system: { objectid: true },
        deleted: { date: true },

        // chunk_split_config defines how to split objects to chunks for common dedup
        // NOTE: changing this config will not allow dedup with existing chunks
        // because the split boundaries will not be detected the same as before
        chunk_split_config: { $ref: 'common_api#/definitions/chunk_split_config' },

        tiers: {
            type: 'array',
            items: {
                type: 'object',
                required: ['order', 'tier'],
                properties: {
                    order: { type: 'integer' },
                    tier: { objectid: true },
                    spillover: { type: 'boolean' },
                    disabled: { type: 'boolean' }
                }
            }
        },
    }
};
