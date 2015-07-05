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
            },
            init: function() {
                this.ingest = new native_util.Ingest();
            },
            transform: function(data) {
                return Q.ninvoke(this.ingest, 'push', data);
            },
            flush: function() {
                return Q.ninvoke(this.ingest, 'flush');
            }
        }));

        pipeline.pipe(transformer({
            options: {
                objectMode: true,
            },
            init: function() {
                var self = this;
                self.count = 0;
                self.bytes = 0;
                self.start = Date.now();
                self.print_speed = function() {
                    var mb_per_sec = self.bytes * 1000 / (Date.now() - self.start) / 1024 / 1024;
                    console.log('', mb_per_sec.toFixed(1), 'MB/s');
                };
            },
            transform: function(data) {
                this.count += 1;
                this.bytes += data.chunk.length;
                process.stdout.write('.');
                if (this.count % 60 === 0) {
                    this.print_speed();
                }
            },
            flush: function() {
                this.print_speed();
                console.log('DONE', this.count, 'chunks');
            }
        }));

        pipeline.run().then(function() {});
    }
}
