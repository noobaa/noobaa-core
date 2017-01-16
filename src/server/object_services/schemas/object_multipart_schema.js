/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    id: 'multipart_schema',
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
            format: 'objectid'
        },

        deleted: {
            format: 'date'
        },

        system: {
            format: 'objectid'
        },

        bucket: {
            format: 'objectid'
        },

        obj: {
            format: 'objectid'
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

    }
};
