/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    id: 'data_chunk_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'size',
        'digest_type',
        'digest_b64',
        'cipher_type',
        'cipher_key_b64',
        'data_frags',
        'lrc_frags',
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

        // every chunk belongs exclusively to a single bucket in order to specify its data placement
        // TODO consider changing chunks to refer to tier/tieringpolicy instead so multiple buckets could share dedup
        bucket: {
            format: 'objectid'
        },

        // size in bytes
        size: {
            type: 'integer'
        },

        // Used in extra replication for video type chunks
        // Currently only the first and the last chunks of the video
        special_replica: {
            type: 'boolean'
        },

        // the key for data dedup, will include both the scope (bucket/tier) and the digest
        // and once the chunk is marked as deleted it will be unset to remove from the index
        dedup_key: {
            type: 'string'
        },

        // data digest (hash) - computed on the plain data before compression and encryption
        digest_type: {
            type: 'string'
        },
        digest_b64: {
            type: 'string'
        },

        // the compression used for the data (optional)
        compress_type: {
            type: 'string',
            enum: ['snappy', 'zlib']
        },
        compress_size: {
            type: 'integer'
        },

        // cipher used to provide confidentiality - computed on the compressed data
        cipher_type: {
            type: 'string'
        },
        cipher_key_b64: {
            type: 'string'
        },
        cipher_iv_b64: {
            type: 'string'
        },
        cipher_auth_tag_b64: {
            type: 'string'
        },

        /*
         * for mapping to edge nodes, the chunk range is divided
         * into k fragments of equal size.
         * this number is configured (by the tier/bucket) but saved in the chunk to allow
         * future changes to the tier's configuration without breaking the chunk's encoding.
         *
         * to support copies and/or erasure coded blocks, chunks are composed of blocks
         * such that each block has a fragment number and a layer:
         *
         * - blocks with layer==='D' contain real data fragment.
         * - blocks with layer==='RS' contain a reed solomon parity fragment.
         * - blocks with layer==='LRC' index contain a computed LRC parity block for the group x,
         *      the fragment index in this case represents the LRC parity index.
         *
         * different blocks with the same value of (frag,layer) - means they are copies
         * of the same data fragment.
         *
         * lrc_frags is the number of fragments in every LRC group (locally recoverable code)
         * this number does not include the added LRC parity fragments, only the source frags.
         *
         * sample layout:
         * (data_frags=8 lrc_frags=4 D=data P=global-parity L=local-parity)
         *
         *      [D D D D] [D D D D] [P P P P]
         *      [  L L  ] [  L L  ] [  L L  ]
         *
         */
        data_frags: {
            type: 'integer'
        },
        lrc_frags: {
            type: 'integer'
        },

    }
};
