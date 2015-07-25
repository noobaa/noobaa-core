'use strict';

module.exports = null;

if (require.main === module) {
    test_ingest();
}

function test_ingest() {

    require('./panic');
    var Q = require('q');
    var fs = require('fs');
    var transformer = require('./transformer');
    var Pipeline = require('./pipeline');
    var input = process.stdin;
    if (process.argv[2]) {
        console.log('FILE', process.argv[2]);
        input = fs.createReadStream(process.argv[2], {
            highWaterMark: 128 * 1024
        });
    }
    var pipeline = new Pipeline(input);
    var stats = {
        count: 0,
        bytes: 0,
        last_bytes: 0,
        start: Date.now(),
        last_start: Date.now(),
    };
    var progress = function(len) {
        process.stdout.write('.');
        // process.stdout.write(len + '.');
        stats.count += 1;
        stats.bytes += len;
        if (stats.count % 60 === 0) {
            var now = Date.now();
            var mb_per_sec = (stats.bytes - stats.last_bytes) *
                1000 / (now - stats.last_start) / 1024 / 1024;
            console.log('', mb_per_sec.toFixed(1), 'MB/s');
            stats.last_bytes = stats.bytes;
            stats.last_start = now;
        }
    };
    var fin = function() {
        var mb_per_sec = stats.bytes * 1000 / (Date.now() - stats.start) / 1024 / 1024;
        console.log('\nDONE.', stats.count, 'chunks.',
            'average speed', mb_per_sec.toFixed(1), 'MB/s');
        process.exit();
    };
    var fin_exit = function() {
        try {
            fin();
        } catch (err) {}
        process.exit();
    };

    process.on('SIGTERM', fin_exit);
    process.on('SIGINT', fin_exit);


    if (!process.argv[3]) {

        var native_util = require("bindings")("native_util.node");
        var chunker_tpool = new native_util.ThreadPool(1);
        var chunker = new native_util.ObjectChunker(chunker_tpool);
        var encoder_tpool = new native_util.ThreadPool(1);
        var encoder = new native_util.ObjectEncoder(encoder_tpool);
        var decoder_tpool = new native_util.ThreadPool(0);
        var decoder = new native_util.ObjectDecoder(decoder_tpool);
        pipeline.pipe(transformer({
            options: {
                objectMode: true,
                highWaterMark: 5
            },
            transform: function(data) {
                return Q.ninvoke(chunker, 'push', data);
            },
            flush: function() {
                return Q.ninvoke(chunker, 'flush');
            }
        }));
        pipeline.pipe(transformer({
            options: {
                objectMode: true,
                highWaterMark: 5
            },
            transform: function(data) {
                return Q.ninvoke(encoder, 'push', data);
            },
        }));
        pipeline.pipe(transformer({
            options: {
                objectMode: true,
                highWaterMark: 5
            },
            transform: function(chunk) {
                return Q.ninvoke(decoder, 'push', chunk);
            },
        }));

    } else {

        // for comparison this is the old javascript impl
        var rabin = require('./rabin');
        var Poly = require('./poly');
        var chunk_crypto = require('./chunk_crypto');
        pipeline.pipe(new rabin.RabinChunkStream({
            window_length: 64,
            min_chunk_size: 3 * 128 * 1024,
            max_chunk_size: 6 * 128 * 1024,
            hash_spaces: [{
                poly: new Poly(Poly.PRIMITIVES[31]),
                hash_bits: 18, // 256 KB average chunk
                hash_val: 0x07071070 // hebrew calculator pimp
            }],
        }));
        pipeline.pipe(transformer({
            options: {
                objectMode: true,
                highWaterMark: 5
            },
            transform: function(data) {
                var crypt_info = {
                    hash_type: 'sha384',
                    cipher_type: 'aes-256-gcm'
                };
                return chunk_crypto.encrypt_chunk(data, crypt_info);
            }
        }));
    }

    pipeline.pipe(transformer({
        options: {
            objectMode: true,
            highWaterMark: 1
        },
        transform: function(chunk) {
            // console.log('done', chunk);
            progress(chunk.length);
        },
    }));

    pipeline.run().then(fin);
}
