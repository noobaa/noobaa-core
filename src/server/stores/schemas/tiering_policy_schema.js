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
        _id: {
            format: 'objectid'
        },
        deleted: {
            format: 'date',
        },
        system: {
            format: 'objectid'
        },
        name: {
            type: 'string',
        },
        tiers: {
            type: 'array',
            items: {
                type: 'object',
                required: ['order', 'tier'],
                properties: {
                    order: {
                        type: 'integer',
                    },
                    tier: {
                        format: 'objectid'
                    },
                }
            }
        },
    }
};
