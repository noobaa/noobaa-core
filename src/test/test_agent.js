// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
/* exported describe, it, before, after, beforeEach, afterEach */
'use strict';

// var _ = require('lodash');
var P = require('../util/promise');
// var assert = require('assert');
var coretest = require('./coretest');

describe('agent', function() {

    var client = coretest.new_client();
    var SYS = 'test-agent-system';

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
                name: 'edge',
                kind: 'edge',
            });
        }).then(function() {
            return coretest.init_test_nodes(10, SYS, 'edge');
        }).nodeify(done);
    });

    after(function(done) {
        this.timeout(20000);
        P.fcall(function() {
            return coretest.clear_test_nodes();
        }).nodeify(done);
    });

    it('should run agents', function(done) {
        // TODO
        done();
    });

});
