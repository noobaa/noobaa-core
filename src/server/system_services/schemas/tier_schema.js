/* Copyright (C) 2016 NooBaa */
'use strict';

const SensitiveString = require('../../../util/sensitive_string');

module.exports = {
    $id: 'tier_schema',
    type: 'object',
    required: [
        '_id',
        'name',
        'system',
        'chunk_config',
        'data_placement',
        'mirrors',
    ],
    properties: {

        // identifiers
        _id: { objectid: true },
        name: { wrapper: SensitiveString },
        system: { objectid: true },
        deleted: { date: true },

        // chunk_config is a link to a frozen config object
        // all chunks will also link to it.
        // we refactored all the constant settings of a chunk that are needed for read/write
        // to optimize the metadata size per chunk.
        // See chunk_config_schema.js
        // this config will be used on all mirrors.
        // NOTE: changing this link to another chunk_config will result in re-coding all the chunks.
        chunk_config: { objectid: true },

        // data placement mirror/spread is based on a user selection
        // between one of these options.
        // however the mapper functions support any combination of mirrors
        // with any number of spread pools per mirror.
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
                required: ['_id', 'spread_pools'],
                properties: {
                    _id: { objectid: true },
                    spread_pools: {
                        type: 'array',
                        items: { objectid: true } // pool id
                    }
                }
            }
        },

    }
};
