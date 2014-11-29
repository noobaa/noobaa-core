// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var size_utils = require('../util/size_utils');

describe('node', function() {

    var coretest = require('./coretest');

    it('works', function(done) {
        Q.fcall(function() {
            return coretest.system_client.create_system({
                name: 'sys'
            });
        }).then(function() {
            // authenticate now with the new system
            return coretest.create_auth({
                system: 'sys'
            });
        }).then(function() {
            return coretest.tier_client.create_tier({
                name: 'tier',
                kind: 'edge',
            });
        }).then(function() {
            return coretest.node_client.create_node({
                name: 'haha',
                tier: 'tier',
                geolocation: 'home',
                storage_alloc: 10 * size_utils.GIGABYTE,
            });
        }).then(function() {
            return coretest.node_client.heartbeat({
                name: 'haha',
                geolocation: 'home',
                storage: {
                    alloc: 10 * size_utils.GIGABYTE,
                    used: size_utils.GIGABYTE,
                },
                online: true,
                heartbeat: new Date().toString(),
                ip: '0.0.0.0',
                port: 0,
                device_info: {
                    os: 'os'
                },
            });
        }).then(function() {
            return coretest.node_client.read_node({
                name: 'haha',
            });
        }).then(function() {
            return coretest.node_client.list_nodes({});
        }).then(function() {
            return coretest.node_client.delete_node({
                name: 'haha',
            });
        }).nodeify(done);
    });


});
