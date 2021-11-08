/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 'multipart_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'bucket',
        'obj',
        'num',
    ],
    properties: {

        _id: {
            objectid: true
        },

        deleted: {
            date: true
        },

        system: {
            objectid: true
        },

        bucket: {
            objectid: true
        },

        obj: {
            objectid: true
        },

        // the multipart number in range 1 - 10000
        num: {
            type: 'integer'
        },

        // size in bytes
        size: {
            type: 'integer'
        },

        // hashes are saved when provided during upload
        // md5 is used for multipart etag
        md5_b64: {
            type: 'string'
        },
        sha256_b64: {
            type: 'string'
        },

        create_time: {
            date: true
        },

        num_parts: { type: 'integer' },

        // the uncommitted property is set on creation, 
        // and unset only once the multipart is chosen to be part of the object.
        // see complete_object_upload()
        uncommitted: { type: 'boolean' },

    }
};
