/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    id: 'tiering_policy_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'name',
        'tiers',
    ],
    properties: {

        // identifiers
        _id: { objectid: true },
        name: { type: 'string' },
        system: { objectid: true },
        deleted: { date: true },

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
