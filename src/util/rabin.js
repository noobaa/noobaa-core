/* jshint node:true */
'use strict';

var _ = require('lodash');
var util = require('util');
var stream = require('stream');
var Poly = require('./poly');

module.exports = {
    Rabin: Rabin,
    RabinChunkStream: RabinChunkStream,
};


/**
 *
 * Rabin
 *
 * compute rabin fingerprint as rolling hash.
 *
 */
function Rabin(poly, window_length, hash_bits) {
    this.poly = poly;
    this.wlen = window_length;

    // truncate hash bits to available polynom bits which is degree-1
    if (hash_bits >= poly.degree) {
        hash_bits = poly.degree - 1;
    }
    if (hash_bits > 32) {
        throw new Error('max hash_bits is 32');
    }
    this.hash_mask = (~0) << (32 - hash_bits) >>> (32 - hash_bits);

    var self = this;

    /**
     * out_table is a byte lookup table that keeps the fingerprint
     * factor to be applied for each byte that leaves the window.
     *
     * in polynom notation if the byte is represented by the polynom b(x)
     * and w is the window length in bits, then the formula is:
     *   out_table(b) = b(x) * x^(w-8) (mod p)
     *
     * by xor-ing this value and the fingerprint we pop out the effect
     * that was created when the byte was pushed into the fingerprint
     * and then shifted through when the rest of the window bytes pushed it forward.
     */
    this.out_table = _.times(256, function(b) {
        var out = poly.zero();
        out = poly.push_byte_mod(out, poly.zero(), b);
        _.times(self.wlen - 1, function() {
            out = poly.push_byte_mod(out, poly.zero(), 0);
        });
        return out;
    });

    this.reset();
}


/**
 *
 * reset
 *
 * reset the window and hash.
 *
 */
Rabin.prototype.reset = function() {
    this.wpos = 0;
    this.window = new Uint8Array(this.wlen);
    this.fingerprint = this.poly.zero();
};


/**
 *
 * append_byte
 *
 * insert new byte to the window and extract one byte from tail,
 * while computing the fingerprint as rolling hash.
 *
 */
Rabin.prototype.append_byte = function(b) {
    var out = this.out_table[this.window[this.wpos]];
    this.window[this.wpos] = b;
    this.wpos = (this.wpos + 1) % this.wlen;
    this.fingerprint = this.poly.push_byte_mod(this.fingerprint, out, b);
    return this.poly.get_word(this.fingerprint, 0) & this.hash_mask;
};


/**
 *
 * sanity
 *
 * calculate current window's fingerprint bit by bit
 * and compare to the rolling hash.
 *
 */
Rabin.prototype.sanity = function() {
    var poly = this.poly;
    var fp = poly.zero();
    var one = poly.mod(1);
    var i = this.wpos;
    do {
        var byte = this.window[i];
        for (var j = 7; j >= 0; --j) {
            fp = poly.shift_bit_mod(fp);
            if (byte & (1 << j)) {
                fp = poly.xor(fp, one);
            }
        }
        i = (i + 1) % this.wlen;
    } while (i !== this.wpos);
    if (!_.isEqual(fp, this.fingerprint)) {
        console.log('*** RABIN IS INSANE ***', fp, this.fingerprint);
        throw new Error('RABIN IS INSANE');
    }
};



/**
 *
 * RabinChunkStream
 *
 * A transforming stream that chunks the input using rabin content chunking.
 *
 * @param params - rabin options: TODO describe options
 * @param options - stream options.
 *
 */
function RabinChunkStream(params, options) {
    stream.Transform.call(this, options);

    this.hash_spaces = params.hash_spaces;
    _.each(params.hash_spaces, function(hspace) {
        hspace.rabin = new Rabin(hspace.poly, params.window_length, hspace.hash_bits);
        hspace.hash_val &= hspace.rabin.hash_mask;
        console.log('RABIN - mask', hspace.rabin.hash_mask.toString(16),
            'average', hspace.rabin.hash_mask + 1, hspace.rabin.poly.toString());
    });

    this.min_chunk_size = Math.max(params.min_chunk_size - params.window_length, 0);
    this.max_chunk_size = params.max_chunk_size;
    this.pending = new Buffer(0);
    this.concat_arr = [null, null];
    this.sanity = params.sanity;
}

// proper inheritance
util.inherits(RabinChunkStream, stream.Transform);


/**
 * implement the stream's Transform._transform() function.
 */
RabinChunkStream.prototype._transform = function(data, encoding, callback) {
    var pos = this.pending.length;
    // console.log(pos, data.length);

    // add the new data to the pending
    // reusing the array to avoid unneeded garbage
    this.concat_arr[0] = this.pending;
    this.concat_arr[1] = data;
    this.pending = Buffer.concat(this.concat_arr, pos + data.length);
    this.concat_arr[0] = null;
    this.concat_arr[1] = null;

    // process when enough ready data is accumulated
    while (pos < this.pending.length && this.pending.length >= this.min_chunk_size) {

        // skip to min_chunk_size - this is a big performance saver...
        if (pos < this.min_chunk_size) {
            pos = this.min_chunk_size;
        }

        var boundary = false;
        var hspaces = this.hash_spaces;
        var stop_pos = Math.min(this.pending.length, this.max_chunk_size);

        while (!boundary && pos < stop_pos) {

            var byte = this.pending[pos];

            boundary = true;
            for (var i = 0; i < hspaces.length; ++i) {
                var h = hspaces[i].rabin.append_byte(byte);
                if (this.sanity) {
                    hspaces[i].rabin.sanity();
                }
                if (boundary && (h !== hspaces[i].hash_val)) {
                    boundary = false;
                }
            }
            pos += 1;
        }

        // push chunk if max exceeded or hash boundary point
        if (boundary || pos >= this.max_chunk_size) {
            var chunk = this.pending.slice(0, pos);
            this.pending = this.pending.slice(pos);
            this.push(chunk);
            pos = 0;
        }
    }
    callback();
};

/**
 * implement the stream's Transform._flush() function.
 */
RabinChunkStream.prototype._flush = function(callback) {
    if (this.pending.length) {
        this.push(this.pending);
    }
    callback();
};
