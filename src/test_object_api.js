// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('underscore');
var Q = require('q');
var assert = require('assert');

describe('object_api', function() {

    var coretest = require('./coretest');
    var object_client = coretest.object_client;

    var BKT = '1_bucket';
    var KEY = '1_key';

    it('works', function(done) {
        Q.fcall(function() {
            return coretest.login_default_account();
        }).then(function() {
            return coretest.object_client.create_bucket({
                bucket: BKT,
            });
        }).then(function() {
            return coretest.object_client.read_bucket({
                bucket: BKT,
            });
        }).then(function() {
            return coretest.object_client.update_bucket({
                bucket: BKT,
            });
        }).then(function() {
            return coretest.object_client.create_object({
                bucket: BKT,
                key: KEY,
                size: 1,
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
            return coretest.object_client.map_object({
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


    it.skip('should read object data', function(done) {
        var EXPECTED_DATA = '';
        var data = '';
        coretest.object_client.open_read_stream({
            bucket: BKT,
            key: KEY,
            start: 0,
            count: 10,
        }).on('data', function(chunk) {
            data += chunk;
        }).on('end', function() {
            assert.deepEqual(data, EXPECTED_DATA);
            done();
        }).on('error', function(err) {
            done(err);
        });
    });

});
