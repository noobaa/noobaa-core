/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    id: 'tier_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'name',
        'replicas',
        'data_fragments',
        'parity_fragments',
        'data_placement',
        'mirrors',
    ],
    properties: {
        replicas: {
            type: 'integer'
        },
        // see data_frags in data_chunk.js
        data_fragments: {
            type: 'integer'
        },
        parity_fragments: {
            type: 'integer'
        },

        // identifiers
        _id: { objectid: true },
        name: { type: 'string' },
        system: { objectid: true },
        deleted: { date: true },

        data_placement: {
            type: 'string',
            enum: ['MIRROR', 'SPREAD']
        },

        // Consist of two dimensional array, spread_pools is an array of pools that will be spread_pools
        // Upper level array (pools) will mirror these spread pools
        mirrors: {
            type: 'array',
            items: {
                type: 'object',
                // required: ['spread_pools'],
                properties: {
                    spread_pools: {
                        type: 'array',
                        items: { objectid: true } // pool id
                    }
                }
            }
        },

    }
};
