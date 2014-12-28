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
function Rabin(poly, window_length) {
    this.poly = poly;
    this.wlen = window_length;

    var self = this;
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
    this.sanity();
    return this.fingerprint;
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
        console.log('*** INSANE ***', fp, this.fingerprint);
        process.exit();
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

    this.rabins = _.map(params.hash_spaces, function(hspace) {
        var rabin = new Rabin(hspace.poly, params.window_length);
        rabin.stream_mask = (1 << hspace.mask_bits) - 1;
        console.log('RABIN', rabin.poly.toString(), rabin.stream_mask.toString(16));
        return rabin;
    });

    this.min_chunk_size = Math.max(params.min_chunk_size - params.window_length, 0);
    this.max_chunk_size = params.max_chunk_size;
    this.pending = new Buffer(0);
    this.concat_arr = [null, null];
}

// proper inheritance
util.inherits(RabinChunkStream, stream.Transform);


/**
 * implement the stream's Transform._transform() function.
 */
RabinChunkStream.prototype._transform = function(data, encoding, callback) {
    var pos = this.pending.length;

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
        var stop_pos = Math.min(this.pending.length, this.max_chunk_size);
        while (!boundary && pos < stop_pos) {
            boundary = true;
            var byte = this.pending.readUInt8(pos);
            for (var i = 0; i < this.rabins.length; ++i) {
                var h = this.rabins[i].append_byte(byte);
                if (boundary && (h & this.rabins[i].stream_mask) !== 0) {
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



function test() {
    var start_time = Date.now();
    var size = 0;
    require('fs')
        .createReadStream('/Users/gu/Movies/720p.webm')
        .pipe(new RabinChunkStream({
            window_length: 32,
            min_chunk_size: 512 * 1024,
            max_chunk_size: 1024 * 1024,
            hash_spaces: [{
                poly: new Poly(Poly.PRIMITIVES[31]),
                mask_bits: 18, // 256 K
                mask_val: []
            }],
        }))
        .on('data', function(chunk) {
            console.log('RABIN CHUNK', chunk.length);
            size += chunk.length;
        })
        .once('error', function(err) {
            console.error('error write stream', err);
        })
        .once('finish', function() {
            var seconds = (Date.now() - start_time) / 1000;
            console.log('speed', (size / 1024 / 1024 / seconds).toFixed(2), 'MB/sec');
        });
}
test();
