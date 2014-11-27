// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('lodash');
var Q = require('q');
var path = require('path');
var assert = require('assert');
var optimist = require('optimist');
var Semaphore = require('noobaa-util/semaphore');
var size_utils = require('../util/size_utils');

var chance_seed = optimist.argv.seed || Date.now();
console.log('using seed', chance_seed);
var chance = require('chance').Chance(chance_seed);


describe.skip('object_api', function() {

    var coretest = require('./coretest');
    var object_client = coretest.object_client;
    var Agent = require('../agent/agent');
    var agents;


    before(function(done) {
        this.timeout(20000);
        Q.fcall(function() {
            return coretest.init_test_nodes(10, size_utils.GIGABYTE);
        }).nodeify(done);
    });

    after(function(done) {
        this.timeout(20000);
        Q.fcall(function() {
            return coretest.clear_test_nodes();
        }).nodeify(done);
    });


    it('works', function(done) {
        var BKT = '1_bucket';
        var KEY = '1_key';
        Q.fcall(function() {
            return coretest.object_client.list_buckets();
        }).then(function() {
            return coretest.object_client.create_bucket({
                bucket: BKT,
            });
        }).then(function() {
            return coretest.object_client.list_buckets();
        }).then(function() {
            return coretest.object_client.read_bucket({
                bucket: BKT,
            });
        }).then(function() {
            return coretest.object_client.update_bucket({
                bucket: BKT,
            });
        }).then(function() {
            return coretest.object_client.create_multipart_upload({
                bucket: BKT,
                key: KEY,
                size: 0,
            });
        }).then(function() {
            return coretest.object_client.complete_multipart_upload({
                bucket: BKT,
                key: KEY,
            });
        }).then(function() {
            return coretest.object_client.read_object_md({
                bucket: BKT,
                key: KEY,
            });
        }).then(function() {
            return coretest.object_client.update_object_md({
                bucket: BKT,
                key: KEY,
            });
        }).then(function() {
            return coretest.object_client.list_bucket_objects({
                bucket: BKT,
            });
        }).then(function() {
            return coretest.object_client.delete_object({
                bucket: BKT,
                key: KEY,
            });
        }).then(function() {
            return coretest.object_client.delete_bucket({
                bucket: BKT,
            });
        }).nodeify(done);
    });


    describe('object IO', function() {
        var BKT = '2_bucket';
        var KEY = '2_key';

        before(function(done) {
            Q.fcall(function() {
                return coretest.object_client.create_bucket({
                    bucket: BKT,
                });
            }).nodeify(done);
        });

        var OBJ_NUM_PARTS = 16;
        var OBJ_PART_SIZE = 128 * 1024;
        var CHANCE_PART_NUM = {
            min: 0,
            max: OBJ_NUM_PARTS,
        };
        var CHANCE_PART_OFFSET = {
            min: 0,
            max: OBJ_PART_SIZE - 1,
        };
        var CHANCE_BYTE = {
            min: 0,
            max: 255,
        };

        it('should write and read object data', function(done) {
            this.timeout(10000);
            var size, data;
            return Q.fcall(function() {
                // randomize size with equal chance on KB sizes
                size = OBJ_PART_SIZE * chance.integer(CHANCE_PART_NUM) +
                    chance.integer(CHANCE_PART_OFFSET);
                // randomize a buffer
                // console.log('random object size', size);
                data = new Buffer(size);
                for (var i = 0; i < size; i++) {
                    data[i] = chance.integer(CHANCE_BYTE);
                }
                return coretest.object_client.create_multipart_upload({
                    bucket: BKT,
                    key: KEY,
                    size: size,
                });
            }).then(function() {
                return Q.Promise(function(resolve, reject) {
                    coretest.object_client.open_write_stream({
                        bucket: BKT,
                        key: KEY,
                    }).once('error', function(err) {
                        reject(err);
                    }).once('finish', function() {
                        resolve();
                    }).end(data);
                });
            }).then(function() {
                return coretest.object_client.complete_multipart_upload({
                    bucket: BKT,
                    key: KEY,
                });
            }).then(function() {
                return Q.Promise(function(resolve, reject) {
                    var buffers = [];
                    coretest.object_client.open_read_stream({
                        bucket: BKT,
                        key: KEY,
                        start: 0,
                        end: size,
                    }).on('data', function(chunk) {
                        console.log('read data', chunk.length);
                        buffers.push(chunk);
                    }).once('end', function() {
                        var read_buf = Buffer.concat(buffers);
                        console.log('read end', read_buf.length);
                        resolve(read_buf);
                    }).once('error', function(err) {
                        console.log('read error', err);
                        reject(err);
                    });
                });
            }).then(function(read_buf) {
                // verify the read buffer equals the written buffer
                for (var i = 0; i < size; i++) {
                    assert.strictEqual(data[i], read_buf[i]);
                }
                console.log('READ SUCCESS');
            }).nodeify(done);
        });
    });

});
