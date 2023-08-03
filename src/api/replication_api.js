/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 *
 * REPLICATION API
 *
 * client (currently web client) talking to the web server to work on replication policy
 *
 */
module.exports = {

    $id: 'replication_api',

    methods: {

        copy_objects: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['src_bucket_name', 'dst_bucket_name', 'keys_diff_map'],
                properties: {
                    copy_type: {
                        type: 'string',
                        enum: ['MIX', 'AWS', 'AZURE', 'NB']
                    },
                    src_bucket_name: { $ref: 'common_api#/definitions/bucket_name' },
                    dst_bucket_name: { $ref: 'common_api#/definitions/bucket_name' },
                    keys_diff_map: {
                        type: 'object',
                        patternProperties: {
                            '.*': {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    additionalProperties: true,
                                    properties: {}
                                }
                            }
                        }
                    },
                }
            },
            reply: {
                type: 'object',
                required: ['num_of_objects', 'size_of_objects'],
                properties: {
                    num_of_objects: { type: 'integer' },
                    size_of_objects: { type: 'integer' }
                },
            },
            auth: {
                system: 'admin'
            }
        },
        delete_objects: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['bucket_name', 'keys'],
                properties: {
                    bucket_name: { $ref: 'common_api#/definitions/bucket_name' },
                    keys: {
                        type: 'array',
                        items: {
                            type: 'string'
                        }
                    },
                }
            },
            reply: {
                type: 'array',
                items: {
                    type: 'string'
                }
            },
            auth: {
                system: 'admin'
            }
        },
    }
};
