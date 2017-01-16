/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    id: 'object_part_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'bucket',
        'obj',
        'chunk',
        'start',
        'end',
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

        // link to the data chunk
        // chunk can be shared by several parts even by different objects for dedup.
        // NOTE: on deletion rename the chunk field to chunk_del to remove from sparse index
        chunk: {
            format: 'objectid'
        },

        // the object that this part belong to.
        // NOTE: on deletion rename the obj field to obj_del to remove from sparse index
        obj: {
            format: 'objectid'
        },

        // the range [start,end) in the object
        // NOTE: on deletion rename the start field to start_del to remove from sparse index
        start: {
            type: 'integer'
        },

        // we prefer to keep the end offset instead of size to allow querying the
        // object for specific offsets and get the relevant parts.
        // end must equal to (start + chunk.size)
        end: {
            type: 'integer'
        },

        // optional offset inside the chunk, used for small files sharing the chunk
        chunk_offset: {
            type: 'integer'
        },

        // for multipart upload we reference a multipart item
        // NOTE: on deletion rename the multipart field to multipart_del to remove from sparse index
        multipart: {
            format: 'objectid'
        },

        // sequential number for the parts in the object
        // for multipart this will start as a sequence per the multipart, and fixed to global sequence on complete.
        seq: {
            type: 'integer'
        },

    }
};
