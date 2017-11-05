/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    id: 'data_block_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'bucket',
        'node',
        'chunk',
        'layer',
        'frag',
        'size',
        'digest_type',
        'digest_b64',
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
        // the chunk redundancy layer and fragment index - see DataChunk
        // when layer==='D' this is the data layer,
        // when layer==='RS' for Reed-Solomon parity,
        // when layer==='LRC' then layer_n is the number of the LRC group.
        layer: {
            type: 'string',
            enum: ['D', 'RS', 'LRC'],
        },
        layer_n: {
            type: 'integer'
        },
        frag: {
            type: 'integer'
        },
        chunk: { objectid: true },

        // block size is the size of the fragment
        // this is the same as the chunk size when not using erasure coding since the chunk has a single fragment
        size: {
            type: 'integer'
        },

        // data block digest (hash) - computed on the encoded fragment as stored on the node
        digest_type: {
            type: 'string',
        },
        digest_b64: {
            type: 'string',
        },

    }
};
