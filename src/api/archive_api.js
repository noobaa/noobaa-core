/* Copyright (C) 2026 NooBaa */
'use strict';

/**
 *
 * ARCHIVE API
 *
 * RPC API for the archive background worker that handles
 * streaming data to/from archive storage classes (GLACIER, DEEP_ARCHIVE, etc).
 *
 */
module.exports = {

    $id: 'archive_api',

    methods: {

        archive_object: {
            method: 'PUT',
            params: {
                type: 'object',
                required: ['obj_id', 'bucket_id', 'target_storage_class'],
                properties: {
                    obj_id: { objectid: true },
                    bucket_id: { objectid: true },
                    target_storage_class: { $ref: 'common_api#/definitions/storage_class_enum' },
                }
            },
            reply: {
                type: 'object',
                properties: {
                    success: { type: 'boolean' },
                }
            },
            auth: { system: 'admin' }
        },

    },

    definitions: {

    }
};
