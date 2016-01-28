'use strict';

// var _ = require('lodash');
var P = require('../util/promise');
var mocha = require('mocha');
// var assert = require('assert');
var coretest = require('./coretest');

mocha.describe('agent', function() {

    var client = coretest.new_client();
    var SYS = 'test-agent-system';

    mocha.before(function() {
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
            });
        }).then(function() {
            return coretest.init_test_nodes(10, SYS, 'edge');
        });
    });

    mocha.after(function() {
        this.timeout(20000);
        return coretest.clear_test_nodes();
    });

    mocha.it('should run agents', function() {
        // TODO
    });

});
