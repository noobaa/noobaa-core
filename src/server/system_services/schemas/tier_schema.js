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
        _id: {
            format: 'objectid'
        },
        deleted: {
            format: 'date'
        },
        system: {
            format: 'objectid'
        },
        name: {
            type: 'string'
        },
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
                        items: {
                            format: 'objectid' // pool id
                        }
                    }
                }
            }
        },

        // // Each tier can be composed of pools OR nodes
        // // This is done for ease of use in cases of small servers number (use nodes)
        // // or large desktop numbers (use pools)
        // pools: {
        //     type: 'array',
        //     items: {
        //         format: 'objectid' // pool id
        //     }
        // },
    }
};
