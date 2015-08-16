/* jshint node:true */
'use strict';

var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;

/**
 *
 * DATA_CHUNK SCHEMA
 *
 * chunk is a logical chunk of data stored persistently.
 * chunks are refered by object parts.
 * chunks are mapped by partitioning to k data blocks.
 *
 */
var data_chunk_schema = new Schema({

    // system is copied from the tier
    system: {
        ref: 'System',
        type: types.ObjectId,
        required: true,
    },

    // optional - a storage tier of this chunk
    tier: {
        ref: 'Tier',
        type: types.ObjectId,
    },

    // optional - a bucket of this chunk
    bucket: {
        ref: 'Bucket',
        type: types.ObjectId,
    },

    // chunk size in bytes
    size: {
        type: Number,
        required: true,
    },

    // data chunk message-digest - computed on the plain data
    digest_type: {
        type: String,
        required: true,
    },
    digest_b64: {
        type: String,
        required: true,
    },
    compress_type: {
        type: String,
        enum: ['snappy', 'zlib']
    },

    // cipher used to provide confidentiality - computed on the plain data
    cipher_type: {
        type: String,
        required: true,
    },
    cipher_key_b64: {
        type: String,
        required: true,
    },
    cipher_iv_b64: {
        type: String,
    },
    cipher_auth_tag_b64: {
        type: String,
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
        type: Number,
        required: true,
    },
    lrc_frags: {
        type: Number,
        required: true,
    },

    building: {
        type: Date
    },
    last_build: {
        type: Date
    },

    // on delete set deletion time
    deleted: {
        type: Date
    },

}, {
    // we prefer to call ensureIndexes explicitly when needed
    autoIndex: false
});

data_chunk_schema.index({
    system: 1,
    digest_b64: 1,
    deleted: 1, // allow to filter deleted
}, {
    unique: false
});

module.exports = mongoose.model('DataChunk', data_chunk_schema);
