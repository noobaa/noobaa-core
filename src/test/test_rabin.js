// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var rabin = require('../util/rabin');
var Poly = require('../util/poly');
var size_utils = require('../util/size_utils');
var RandStream = require('../util/rand_stream');


describe('rabin', function() {

    it('rabin deg=16 on random stream', function(done) {
        this.timeout(10000);
        test_chunking(10 * 1024, 16).nodeify(done);
    });

    it('rabin deg=31 on random stream', function(done) {
        this.timeout(10000);
        test_chunking(10 * 1024, 31).nodeify(done);
    });

    it.skip('rabin deg=32 on random stream', function(done) {
        this.timeout(10000);
        test_chunking(10 * 1024, 32).nodeify(done);
    });

    it('rabin deg=63 on random stream', function(done) {
        this.timeout(10000);
        test_chunking(10 * 1024, 63).nodeify(done);
    });

    function test_chunking(length, degree) {
        var defer = Q.defer();
        var start_time = Date.now();
        var size = 0;
        var count = 0;
        new RandStream(length)
            .pipe(new rabin.RabinChunkStream({
                sanity: true,
                window_length: 4,
                min_chunk_size: 10,
                max_chunk_size: 100,
                hash_spaces: [{
                    poly: new Poly(Poly.PRIMITIVES[degree]),
                    hash_bits: 6,
                    hash_val: 0x07071070
                }],
            }))
            .on('data', function(chunk) {
                // console.log('RABIN CHUNK', chunk.length);
                size += chunk.length;
                count += 1;
            })
            .once('error', function(err) {
                console.error('error write stream', err);
                defer.reject(err);
            })
            .once('finish', function() {
                var seconds = (Date.now() - start_time) / 1000;
                console.log('got', size_utils.human_size(size), 'in', count, 'chunks',
                    'at', size_utils.human_size(size / seconds) + '/sec');
                defer.resolve();
            });
        return defer.promise;
    }

});
