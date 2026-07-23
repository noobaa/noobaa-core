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

        delete_archive_objects: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['bucket_id', 'objects'],
                properties: {
                    bucket_id: { objectid: true },
                    objects: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['obj_id'],
                            properties: {
                                obj_id: { objectid: true },
                                key: { type: 'string' },
                            }
                        }
                    },
                }
            },
            reply: {
                type: 'object',
                required: ['reclaimed_ids', 'has_errors'],
                properties: {
                    reclaimed_ids: {
                        type: 'array',
                        items: { objectid: true },
                    },
                    has_errors: { type: 'boolean' },
                }
            },
            auth: { system: 'admin' }
        },

    },

    definitions: {

    }
};
