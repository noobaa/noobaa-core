// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('lodash');
var Q = require('q');
var path = require('path');
var assert = require('assert');
var argv = require('minimist')(process.argv);
var Semaphore = require('noobaa-util/semaphore');
var size_utils = require('../util/size_utils');
var coretest = require('./coretest');


describe('bucket', function() {

    var client = coretest.new_client();

    before(function(done) {
        this.timeout(20000);
        Q.fcall(function() {
            return client.system.create_system({
                name: 'sys'
            });
        }).then(function() {
            // authenticate now with the new system
            return client.create_auth_token({
                system: 'sys'
            });
        }).then(function() {
            return client.tier.create_tier({
                name: 'edge',
                kind: 'edge',
            });
        }).nodeify(done);
    });

    it('works', function(done) {
        Q.fcall(function() {
            return client.bucket.list_buckets();
        }).then(function() {
            return client.bucket.create_bucket({
                name: 'bkt',
                tiering: ['edge'],
            });
        }).then(function() {
            return client.bucket.list_buckets();
        }).then(function() {
            return client.bucket.read_bucket({
                name: 'bkt',
            });
        }).then(function() {
            return client.bucket.update_bucket({
                name: 'bkt',
                new_name: 'bkt2',
                tiering: ['edge'],
            });
        }).then(function() {
            return client.bucket.read_bucket({
                name: 'bkt2',
            });
        }).then(function() {
            return client.bucket.delete_bucket({
                name: 'bkt2',
            });
        }).nodeify(done);
    });

});
