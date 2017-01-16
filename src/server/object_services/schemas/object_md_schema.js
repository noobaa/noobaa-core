/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    id: 'object_md_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'bucket',
        'key',
        'content_type',
    ],
    properties: {

        _id: {
            format: 'objectid'
        },

        // on delete set deletion time
        // see relation to cloud_synced, if deleted will ever be actually
        // remove from the DB, need to wait until its cloud_synced === true
        deleted: {
            format: 'date'
        },

        system: {
            format: 'objectid'
        },

        bucket: {
            format: 'objectid'
        },

        // the object key is sort of a path in the bucket namespace
        key: {
            type: 'string'
        },

        // size in bytes
        // NOTE: only updated once upload ends
        size: {
            type: 'integer'
        },

        // number of objects parts created for this object
        // NOTE: only updated once upload ends
        num_parts: {
            type: 'integer'
        },

        // MIME
        content_type: {
            type: 'string'
        },

        // upload_size is filled for objects while uploading,
        // and ultimatly removed once the write is done
        upload_size: {
            type: 'integer'
        },

        upload_started: {
            format: 'date'
        },

        create_time: {
            format: 'date'
        },

        // etag is the object md5 hex for objects uploaded in single action.
        // for multipart upload etag is a special aggregated md5 of the parts md5's.
        etag: {
            type: 'string',
        },

        // hashes are saved when provided during upload
        // md5 is used for etag of non-multipart uploads
        md5_b64: {
            type: 'string'
        },
        sha256_b64: {
            type: 'string'
        },

        // is the object synced with the cloud
        cloud_synced: {
            type: 'boolean',
        },

        // xattr saved as free form object
        xattr: {
            type: 'object',
            additionalProperties: true,
            properties: {}
        },

        // Statistics
        stats: {
            type: 'object',
            properties: {
                reads: {
                    type: 'integer'
                },
                last_read: {
                    format: 'date'
                },
            }
        },

    }
};
