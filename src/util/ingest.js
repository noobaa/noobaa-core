'use strict';

module.exports = null;

if (require.main === module) {
    test_ingest();
}

function test_ingest() {

    require('./panic');
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
                highWaterMark: 10
            },
            init: function() {
                var tpool = new native_util.ThreadPool(1);
                this.write_proc = new native_util.WriteProcessor(tpool);
            },
            transform: function(data) {
                return Q.ninvoke(this.write_proc, 'push', data);
            },
            flush: function() {
                return Q.ninvoke(this.write_proc, 'flush');
            }
        }));
/*
        pipeline.pipe(transformer({
            options: {
                objectMode: true,
                highWaterMark: 10
            },
            init: function() {
                var tpool = new native_util.ThreadPool(1);
                this.read_proc = new native_util.ReadProcessor(tpool);
            },
            transform: function(data) {
                return Q.ninvoke(this.read_proc, 'push', data.buf);
            },
            flush: function() {
                return Q.ninvoke(this.read_proc, 'flush');
            }
        }));
*/
        pipeline.pipe(transformer({
            options: {
                objectMode: true,
                highWaterMark: 1
            },
            init: function() {
                this.count = 0;
                this.bytes = this.last_bytes = 0;
                this.start = this.last_start = Date.now();
            },
            transform: function(data) {
                this.count += 1;
                this.bytes += data.buf.length;
                // process.stdout.write(data.buf.length + '.');
                process.stdout.write('.');
                if (this.count % 60 === 0) {
                    var now = Date.now();
                    var mb_per_sec = (this.bytes - this.last_bytes) *
                        1000 / (now - this.last_start) / 1024 / 1024;
                    console.log('', mb_per_sec.toFixed(1), 'MB/s');
                    this.last_bytes = this.bytes;
                    this.last_start = now;
                }
            },
            flush: function() {
                var mb_per_sec = this.bytes * 1000 / (Date.now() - this.start) / 1024 / 1024;
                console.log('\nDONE.', this.count, 'chunks.',
                    'average speed', mb_per_sec.toFixed(1), 'MB/s');
            }
        }));

        pipeline.run().then(function() {});
    }
}
