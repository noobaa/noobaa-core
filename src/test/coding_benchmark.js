'use strict';

module.exports = null;

if (require.main === module) {
    test_ingest();
}

function test_ingest() {

    require('../util/panic');
    var Q = require('q');
    var fs = require('fs');
    var transformer = require('../util/transformer');
    var Pipeline = require('../util/pipeline');
    var input = process.stdin;
    if (process.argv[2]) {
        console.log('FILE', process.argv[2]);
        input = fs.createReadStream(process.argv[2], {
            highWaterMark: 1024 * 1024
        });
    }
    var mode = process.argv[3];
    var stats = {
        count: 0,
        bytes: 0,
        compress_bytes: 0,
        last_bytes: 0,
        start: Date.now(),
        last_start: Date.now(),
    };
    var pipeline = new Pipeline(input);
    var progress = function(size, compress_size) {
        process.stdout.write('.');
        // process.stdout.write(size + '.');
        stats.count += 1;
        stats.bytes += size;
        stats.compress_bytes += compress_size;
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
            'average speed', mb_per_sec.toFixed(1), 'MB/s',
            'average chunk size', (stats.bytes / stats.count).toFixed(1),
            'compression ratio', (100 * stats.compress_bytes / stats.bytes).toFixed(1) + '%');
        process.exit();
    };
    var fin_exit = function() {
        try {
            fin();
        } catch (err) {
            console.error(err.stack || err);
        }
        process.abort();
    };

    process.on('SIGTERM', fin_exit);
    process.on('SIGINT', fin_exit);


    if (!mode || mode === '1') {

        var native_util = require("bindings")("native_util.node");
        var dedup_chunker = new native_util.DedupChunker({
            tpool: new native_util.ThreadPool(1)
        });
        var object_coding = new native_util.ObjectCoding({
            tpool: new native_util.ThreadPool(2),
            digest_type: 'sha384',
            compress_type: 'snappy',
            cipher_type: 'aes-256-gcm',
            frag_digest_type: 'sha1',
            data_frags: 1,
            parity_frags: 0,
            lrc_frags: 0,
            lrc_parity: 0,
        });
        pipeline.pipe(transformer({
            options: {
                objectMode: true,
                highWaterMark: 10
            },
            transform: function(data) {
                return Q.ninvoke(dedup_chunker, 'push', data);
            },
            flush: function() {
                return Q.ninvoke(dedup_chunker, 'flush');
            }
        }));
        pipeline.pipe(transformer({
            options: {
                objectMode: true,
                highWaterMark: 10
            },
            transform: function(data) {
                return Q.ninvoke(object_coding, 'encode', data);
            },
        }));
        pipeline.pipe(transformer({
            options: {
                objectMode: true,
                highWaterMark: 10
            },
            transform: function(chunk) {
                if (mode === '1') {
                    return Q.ninvoke(object_coding, 'decode', chunk).thenResolve(chunk);
                } else {
                    return chunk;
                }
            },
        }));

    } else {

        // for comparison this is the old javascript impl
        var rabin = require('../../attic/rabin');
        var Poly = require('../../attic/poly');
        var chunk_crypto = require('../../attic/chunk_crypto');
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
            progress(chunk.size || chunk.length || 0, chunk.compress_size || 0);
        },
    }));

    pipeline.run().then(fin);
}
