/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 'data_block_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'bucket',
        'node',
        'chunk',
        'size',
    ],
    properties: {

        _id: { objectid: true },
        system: { objectid: true },
        deleted: { date: true },

        // bucket is copied from the chunk
        // every chunk belongs exclusively to a single bucket in order to specify its data placement
        // TODO consider changing chunks to refer to tier/tieringpolicy instead so multiple buckets could share dedup
        bucket: { objectid: true },

        // the storage node of this block, and the associated pool
        node: { objectid: true },
        pool: { objectid: true },

        // (chunk,frag) define the block content
        chunk: { objectid: true },
        frag: { objectid: true },

        // block size is the size of the fragment
        // this is the same as the chunk size when not using erasure coding since the chunk has a single fragment
        size: { type: 'integer' },
        reclaimed: { date: true },

    }
};
