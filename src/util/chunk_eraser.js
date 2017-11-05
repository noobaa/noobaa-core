/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const stream = require('stream');
const Chance = require('chance');

const chance = new Chance();

/**
 *
 * ChunkEraser
 *
 * "Erase" means here to remove from memory some frags from the chunk.
 * This is a Transform stream meant to be pipelined between one ChunkCoder doing encode
 * and another ChunkCoder doing decode, for tests.
 *
 */
class ChunkEraser extends stream.Transform {

    constructor({ watermark, erasures, save_data, verbose }) {
        super({
            objectMode: true,
            allowHalfOpen: false,
            highWaterMark: watermark,
        });
        this.erasures = erasures;
        this.save_data = save_data;
        this.verbose = verbose;
        this.pos = 0;
    }

    _transform(chunk, encoding, callback) {

        // Here we are removing the chunk.data property to make sure the decoder 
        // will really be tested in reconstructing the data,
        // but allowing the caller pipeline to ask to save the original data
        // in that case we save the original as a different property of the chunk
        // which can be used to compare with original data later.
        if (this.save_data) chunk[this.save_data] = chunk.data;
        chunk.data = null;

        // checking the position is continuous
        if (chunk.pos !== this.pos) {
            return callback(new Error(`ChunkEraser: chunk pos ${chunk.pos} !== ${this.pos}`));
        }
        this.pos += chunk.size;

        const data_frags = (chunk.chunk_coder_config && chunk.chunk_coder_config.data_frags) || 0;
        const parity_frags = (chunk.chunk_coder_config && chunk.chunk_coder_config.parity_frags) || 0;
        const erasures = this.erasures === undefined ?
            chance.integer({ min: 0, max: parity_frags }) :
            this.erasures;
        const num_frags_to_keep = data_frags + parity_frags - erasures;

        if (chunk.frags.length !== data_frags + parity_frags) {
            return callback(new Error(`ChunkEraser: frags count ${chunk.frags.length} !== ${data_frags}+${parity_frags}`));
        }

        // remove frags from the list, picking at random from the list
        while (chunk.frags.length > num_frags_to_keep && chunk.frags.length) {
            const frag = chance.pick(chunk.frags);
            _.pull(chunk.frags, frag);
        }

        if (this.verbose) console.log(`ChunkEraser: erased ${erasures} frags in chunk`, chunk);
        return callback(null, chunk);
    }

}

module.exports = ChunkEraser;
