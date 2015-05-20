// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
/* exported describe, it, before, after, beforeEach, afterEach */
'use strict';

// var _ = require('lodash');
var Q = require('q');
var fs = require('fs');
var path = require('path');
var rabin = require('../util/rabin');
var Poly = require('../util/poly');
var size_utils = require('../util/size_utils');
var RandStream = require('../util/rand_stream');


describe('rabin', function() {

    var PERF = process.env.RABIN_TEST_PERF;

    it('rabin deg=16 on random stream', function(done) {
        this.timeout(1000000);
        test_chunking(16).nodeify(done);
    });

    it('rabin deg=31 on random stream', function(done) {
        this.timeout(1000000);
        test_chunking(31).nodeify(done);
    });

    // TODO degree 32 still fails on bad calculations (overflowing single word)
    it.skip('rabin deg=32 on random stream', function(done) {
        this.timeout(1000000);
        test_chunking(32).nodeify(done);
    });

    it('rabin deg=63 on random stream', function(done) {
        this.timeout(1000000);
        test_chunking(63).nodeify(done);
    });

    it('test_rabin_file1', function(done) {
        this.timeout(1000000);
        test_file('test_rabin_file1.txt').nodeify(done);
    });

    function test_chunking(degree) {
        var len = PERF ? (32 * 1024 * 1024) : (1 * 1024);
        var part_len = (len / 64) | 0;
        return stream_promise(
            new RandStream(len, {
                highWaterMark: 1024 * 1024,
            })
            .pipe(new rabin.RabinChunkStream({
                sanity: !PERF,
                window_length: 128,
                min_chunk_size: ((part_len / 4) | 0) * 3,
                max_chunk_size: ((part_len / 4) | 0) * 6,
                hash_spaces: [{
                    poly: new Poly(Poly.PRIMITIVES[degree]),
                    hash_bits: (Math.log(part_len) / Math.log(2)) - 1,
                    hash_val: 0x07071070 // hebrew calculator pimp
                }],
            })));
    }

    function test_file(file_name) {
        // copied from object_driver
        var OBJECT_RANGE_ALIGN_NBITS = 19; // log2( 512 KB )
        var OBJECT_RANGE_ALIGN = 1 << OBJECT_RANGE_ALIGN_NBITS; // 512 KB

        var file_path = path.join(__dirname, file_name);
        var stream = fs.createReadStream(file_path);
        return stream_promise(
            stream.pipe(new rabin.RabinChunkStream({
                sanity: !PERF,
                window_length: 128,
                min_chunk_size: ((OBJECT_RANGE_ALIGN / 4) | 0) * 3,
                max_chunk_size: ((OBJECT_RANGE_ALIGN / 4) | 0) * 6,
                hash_spaces: [{
                    poly: new Poly(Poly.PRIMITIVES[31]),
                    hash_bits: OBJECT_RANGE_ALIGN_NBITS - 1, // 256 KB average chunk
                    hash_val: 0x07071070 // hebrew calculator pimp
                }],
            })));
    }

    function stream_promise(stream) {
        var defer = Q.defer();
        var start_time = Date.now();
        var size = 0;
        var count = 0;
        stream.on('data', function(chunk) {
                process.stdout.write('/' + chunk.length);
                size += chunk.length;
                count += 1;
            })
            .once('error', function(err) {
                console.log('/');
                console.error('error write stream', err);
                defer.reject(err);
            })
            .once('finish', function() {
                console.log('/');
                var seconds = (Date.now() - start_time) / 1000;
                console.log('got', size_utils.human_size(size), 'in', count, 'chunks',
                    'at', size_utils.human_size(size / seconds) + '/sec');
                defer.resolve();
            });
        return defer.promise;
    }

});
