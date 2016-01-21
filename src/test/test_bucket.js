// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
/* exported describe, it, before, after, beforeEach, afterEach */
'use strict';

// var _ = require('lodash');
var P = require('../util/promise');
// var assert = require('assert');
var coretest = require('./coretest');

describe('bucket', function() {

    const SYS = 'test_bucket_system';
    const TIER = 'test_bucket_tier';
    const BKT = 'test_bucket_bucket';

    var client = coretest.new_client();

    before(function(done) {
        this.timeout(20000);
        P.fcall(function() {
            return client.system.create_system({
                name: SYS
            });
        }).then(function() {
            // authenticate now with the new system
            return client.create_auth_token({
                system: SYS
            });
        }).then(function() {
            return client.tier.create_tier({
                name: TIER,
            });
        }).nodeify(done);
    });

    it('works', function(done) {
        P.fcall(function() {
            return client.bucket.list_buckets();
        }).then(function() {
            return client.bucket.create_bucket({
                name: BKT,
                tiering: [{
                    tier: TIER
                }],
            });
        }).then(function() {
            return client.bucket.list_buckets();
        }).then(function() {
            return client.bucket.read_bucket({
                name: BKT,
            });
        }).then(function() {
            return client.bucket.update_bucket({
                name: BKT,
                new_name: BKT + '2',
                tiering: [{
                    tier: TIER
                }],
            });
        }).then(function() {
            return client.bucket.read_bucket({
                name: BKT + '2',
            });
        }).then(function() {
            return client.bucket.delete_bucket({
                name: BKT + '2',
            });
        }).nodeify(done);
    });

});
