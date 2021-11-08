/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 *
 * SCRUBBER API
 *
 */
module.exports = {

    $id: 'scrubber_api',

    methods: {

        build_chunks: {
            method: 'PUT',
            params: {
                type: 'object',
                required: ['chunk_ids'],
                properties: {
                    chunk_ids: {
                        type: 'array',
                        items: { objectid: true }
                    },
                    tier: { objectid: true },
                    evict: {
                        type: 'boolean',
                    },
                }
            },
            auth: { system: 'admin' }
        },

        make_room_in_tier: {
            method: 'PUT',
            params: {
                type: 'object',
                required: ['bucket', 'tier'],
                properties: {
                    bucket: { objectid: true },
                    tier: { objectid: true },
                }
            },
            auth: { system: 'admin' }
        },

    },

    definitions: {

    }
};
