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

        move_objects_by_type: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['copy_type', 'src_bucket_name', 'dst_bucket_name', 'keys'],
                properties: {
                    copy_type: {
                        type: 'string',
                        enum: ['MIX', 'AWS', 'AZURE', 'NB']
                    },
                    src_bucket_name: { $ref: 'common_api#/definitions/bucket_name' },
                    dst_bucket_name: { $ref: 'common_api#/definitions/bucket_name' },
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
