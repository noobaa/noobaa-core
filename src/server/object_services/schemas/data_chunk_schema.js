/* Copyright (C) 2016 NooBaa */
'use strict';

/*
 * for mapping to edge nodes, chunk data is divided into fragments of equal size.
 * this number is configured (by the tier/bucket) but saved in the chunk to allow
 * future changes to the tier's configuration without breaking the chunk's encoding.
 *
 * to support copies and/or erasure coded blocks, chunks are composed of fragments
 * such that each fragment has a purpose:
 *
 * - fragments containing real data fragment
 * - fragments containing global parity fragment.
 * - fragments containing local parity fragment per redundancy group (LRC)
 *
 * data blocks specify frag, and when two blocks have the same frag it means
 * they are copies of the same fragment.
 *
 * lrc_group is the number of fragments in every LRC group (locally recoverable code)
 * this number does not include the added LRC parity fragments, only the source frags.
 *
 * sample layout:
 * (data_frags=8 lrc_group=4 D=data P=global-parity L=local-parity)
 *
 *      [D0 D1 D2 D3] [D4 D5 D6 D7] [P0 P1 P2 P3]
 *      [ L0:0 L0:1 ] [ L1:0 L1:1 ] [ L2:0 L2:1 ]
 *
 */
module.exports = {
    $id: 'data_chunk_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'size',
    ],
    properties: {

        // identification
        _id: { objectid: true },
        system: { objectid: true },
        deleted: { date: true },

        // every chunk belongs exclusively to a bucket for data placement and storage accounting
        bucket: { objectid: true },
        // tiering
        tier: { objectid: true },
        tier_lru: { date: true },

        // chunk_config defines how to decode the chunk data, and @@@ MUST NOT CHANGE @@@
        chunk_config: { objectid: true },

        // size in bytes
        size: { type: 'integer' },
        // the compressed size of the data
        compress_size: { type: 'integer' },
        // the frag size is saved although can be computed from size and chunk_config
        // because the calculation requires padding and is easier to share this way
        frag_size: { type: 'integer' },

        // TODO: This value is depricated and not used anymore. Should remove from all systems in the future
        // Used in extra replication for video type chunks
        // Currently only the first and the last chunks of the video
        special_replica: { type: 'boolean' },

        // the key for data dedup, will include both the scope (bucket/tier) and the digest
        // and once the chunk is marked as deleted it will be unset to remove from the index
        dedup_key: { binary: true },

        // data digest (hash) - computed on the plain data before compression and encryption
        digest: { binary: true },

        // cipher used to provide confidentiality - computed on the compressed data
        cipher_key: { binary: true },
        cipher_iv: { binary: true },
        cipher_auth_tag: { binary: true },

        master_key_id: { objectid: true },
        frags: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    _id: { objectid: true },
                    data_index: { type: 'integer' },
                    parity_index: { type: 'integer' },
                    lrc_index: { type: 'integer' },
                    digest: { binary: true },
                }
            }
        },

    }
};
