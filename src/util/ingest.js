'use strict';

module.exports = null;

if (require.main === module) {
    test_ingest();
}

function test_ingest() {
    var fs = require('fs');
    var transformer = require('./transformer');
    var input = process.stdin;
    if (process.argv[2]) {
        console.log('FILE', process.argv[2]);
        input = fs.createReadStream(process.argv[2], {
            highWaterMark: 1024 * 1024
        });
    }

    if (process.argv[3]) {
        var rabin = require('./src/util/rabin');
        var Poly = require('./src/util/poly');
        input.pipe(new rabin.RabinChunkStream({
            window_length: 128,
            min_chunk_size: 3 * 128 * 1024,
            max_chunk_size: 6 * 128 * 1024,
            hash_spaces: [{
                poly: new Poly(Poly.PRIMITIVES[31]),
                hash_bits: 18, // 256 KB average chunk
                hash_val: 0x07071070 // hebrew calculator pimp
            }],
        })).on('data', function(data) {
            console.log('JS RABIN', data.length);
        });
    } else {
        var Q = require('q');
        var native_util = require("bindings")("native_util.node");
        var Pipeline = require('./pipeline');
        var pipeline = new Pipeline(input);

        pipeline.pipe(transformer({
            options: {
                objectMode: true,
            },
            init: function() {
                this.ingest = new native_util.Ingest();
            },
            transform: function(data) {
                return Q.ninvoke(this.ingest, 'push', data);
            },
            flush: function() {
                console.log('INPUT END');
                return Q.ninvoke(this.ingest, 'flush');
            }
        }));

        pipeline.pipe(transformer({
            options: {
                objectMode: true,
            },
            transform: function(data) {
                // console.log('OUTPUT', data.chunk.length, 'sha(' + data.sha + ')');
                process.stdout.write(data.chunk.length + ',');
            },
            flush: function() {
                console.log('OUTPUT END');
            }
        }));
    }
}
