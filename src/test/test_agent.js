// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var coretest = require('./coretest');
var Agent = require('../agent/agent');
var size_utils = require('../util/size_utils');

describe('agent', function() {

    before(function(done) {
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
                name: 'edge',
                kind: 'edge',
            });
        }).then(function() {
            return coretest.init_test_nodes(10, 'sys', 'edge', size_utils.GIGABYTE);
        }).nodeify(done);
    });

    after(function(done) {
        Q.fcall(function() {
            return coretest.clear_test_nodes();
        }).nodeify(done);
    });

    it('should run agents', function(done) {
        // TODO
        done();
    });

});
