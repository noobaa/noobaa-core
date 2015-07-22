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
        var stats = {
            count: 0,
            bytes: 0,
            last_bytes: 0,
            start: Date.now(),
            last_start: Date.now(),
        };
        var fin = function() {
            var mb_per_sec = stats.bytes * 1000 / (Date.now() - stats.start) / 1024 / 1024;
            console.log('\nDONE.', stats.count, 'chunks.',
                'average speed', mb_per_sec.toFixed(1), 'MB/s');
            process.exit();
        };
        var fin_exit = function() {
            fin();
            process.exit();
        };
        process.on('SIGTERM', fin_exit);
        process.on('SIGINT', fin_exit);

        pipeline.pipe(transformer({
            options: {
                objectMode: true,
                highWaterMark: 10
            },
            init: function() {
                var tpool = new native_util.ThreadPool(1);
                this.write_proc = new native_util.WriteProcessor(tpool);
                this.write_proc.tpool2 = new native_util.ThreadPool(1);
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
            transform: function(data) {
                stats.count += 1;
                stats.bytes += data.buf.length;
                // process.stdout.write(data.buf.length + '.');
                process.stdout.write('.');
                if (stats.count % 60 === 0) {
                    var now = Date.now();
                    var mb_per_sec = (stats.bytes - stats.last_bytes) *
                        1000 / (now - stats.last_start) / 1024 / 1024;
                    console.log('', mb_per_sec.toFixed(1), 'MB/s');
                    stats.last_bytes = stats.bytes;
                    stats.last_start = now;
                }
            },
        }));

        pipeline.run().then(fin);

    }
}
