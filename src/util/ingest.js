'use strict';


if (require.main === module) {
    test_ingest();
}

function test_ingest() {
    var fs = require('fs');
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
        var native_util = require("bindings")("native_util.node");
        var ingest = new native_util.Ingest_v1(function(chunk, sha256) {
            // console.log('OUTPUT', chunk.length, 'sha256(' + sha256 + ')');
        });
        input.on('data', function(data) {
            process.stdout.write(data.length + ',');
            ingest.push(data);
        }).on('end', function() {
            console.log('INPUT END');
            ingest.flush();
        });
    }
}
