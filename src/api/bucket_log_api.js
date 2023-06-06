/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 *
 * NOOBAA BUCKET LOGGING API
 *
 */
module.exports = {

    $id: 'bucket_log_api',

    methods: {

        put_bucket_log_object: {
            method: 'PUT',
            params: {
                type: 'object',
                required: ['source_bucket', 'logs'],
                properties: {
                    source_bucket: { $ref: 'common_api#/definitions/bucket_name' },
                    logs: {
                        type: 'array',
                        items: {
                            type: 'string'
                        }
                    },
                }
            },
            auth: {
                system: 'admin'
            }
        },
    }
};
