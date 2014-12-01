// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var coretest = require('./coretest');

describe('tier', function() {

    var client = coretest.new_client();
    var SYS = 'test-tier-system';

    it('crud', function(done) {
        this.timeout(20000);
        var system_id;
        Q.fcall(function() {
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
                name: 'edge',
                kind: 'edge',
                edge_details: {
                    replicas: 2,
                    data_fragments: 200,
                    parity_fragments: 100,
                }
            });
        }).then(function() {
            return client.tier.create_tier({
                name: 'cloud',
                kind: 'cloud',
                cloud_details: {
                    access_key: 'access_key',
                    secret: 'secret',
                    region: 'region',
                }
            });
        }).then(function() {
            return client.tier.read_tier({
                name: 'edge',
            });
        }).then(function() {
            return client.tier.read_tier({
                name: 'cloud',
            });
        }).then(function() {
            return client.tier.update_tier({
                name: 'cloud',
                new_name: 'cloudy',
                cloud_details: {
                    access_key: 'access_key2',
                    secret: 'secret2',
                    region: 'region2',
                }
            });
        }).then(function() {
            return client.tier.delete_tier({
                name: 'edge',
            });
        }).then(function() {
            return client.tier.delete_tier({
                name: 'cloud',
            }).then(function() {
                throw new Error('expected not found error');
            }, function(err) {
                console.log(err);
                assert.strictEqual(err.data, 'tier not found');
            });
        }).then(function() {
            return client.tier.delete_tier({
                name: 'cloudy',
            });
        }).then(function() {
            return client.system.read_system();
        }).nodeify(done);
    });

});
