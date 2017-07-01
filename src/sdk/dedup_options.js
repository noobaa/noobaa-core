/* Copyright (C) 2016 NooBaa */
'use strict';

var js_utils = require('../util/js_utils');

// DO NOT CHANGE UNLESS YOU *KNOW* RABIN CHUNKING
var dedup_config = js_utils.deep_freeze({

    // min_chunk bytes are skipped before looking for new boundary.
    // max_chunk is the length which will be chunked if not chunked by context.
    // the context average chunking length will be: min_chunk + (2^avg_chunk_bits)
    // ~ 512 KB CHUNKING:
    min_chunk: 3 * 128 * 1024,
    max_chunk: 6 * 128 * 1024,
    avg_chunk_bits: 17, // 2^17 = 128K above min_chunk
    // ~ 4 MB CHUNKING:
    // min_chunk: (4 * 1024 * 1024) - (512 * 1024),
    // max_chunk: (4 * 1024 * 1024) + (512 * 1024),
    // avg_chunk_bits: 19, // 2^19 = 512KB above min_chunk

    // window_len is the amount of bytes in the rabin window.
    // the bigger the window the more context there is to the hash,
    // which reduces "false" chunk boundaries, not sure why not use bigger.
    window_len: 64,

    // using high gf_degree to allow high values of AVG_CHUNK_BITS
    // gf_poly 0x3 is a representation of a primitive polynom in GF(2^63) - x^63 + x^1 + x^0
    // http://web.eecs.utk.edu/~plank/plank/papers/CS-07-593/primitive-polynomial-table.txt
    gf_degree: 63,
    gf_poly: 0x3,
});

module.exports = dedup_config;
