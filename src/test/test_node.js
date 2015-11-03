// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
/* exported describe, it, before, after, beforeEach, afterEach */
'use strict';

// var _ = require('lodash');
var P = require('../util/promise');
// var assert = require('assert');
var size_utils = require('../util/size_utils');
var coretest = require('./coretest');
var os_util = require('../util/os_util');

describe('node', function() {

    var client = coretest.new_client();
    var SYS = 'test-node-system';

    it('works', function(done) {
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
                name: 'tier',              
            });
        }).then(function() {
            return client.node.create_node({
                name: 'haha',
                tier: 'tier',
                geolocation: 'home',
            });
        }).then(function(res) {
            return client.node.heartbeat({
                name: 'haha',
                id: res.id,
                geolocation: 'home',
                port: 0,
                storage: {
                    alloc: 10 * size_utils.GIGABYTE,
                    used: size_utils.GIGABYTE,
                },
                os_info: os_util.os_info(),
            });
        }).then(function() {
            return client.node.read_node({
                name: 'haha',
            });
        }).then(function() {
            return client.node.list_nodes({});
        }).then(function() {
            return client.node.delete_node({
                name: 'haha',
            });
        }).nodeify(done);
    });


});
