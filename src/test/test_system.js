// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
/* exported describe, it, before, after, beforeEach, afterEach */
'use strict';

// var _ = require('lodash');
var P = require('../util/promise');
// var assert = require('assert');
var coretest = require('./coretest');

describe('system', function() {

    var client = coretest.new_client();
    var SYS1 = 'test-system-1';
    var SYS2 = 'test-system-2';
    var EMAIL = 'test-system@test.test';
    var PASSWORD = 'test-system-password';

    it('crud', function(done) {
        this.timeout(20000);
        P.fcall(function() {
            return client.system.create_system({
                name: SYS1,
            });
        }).then(function() {
            // authenticate now with the new system
            return client.create_auth_token({
                system: SYS1
            });
        }).then(function() {
            return client.system.read_system();
        }).then(function() {
            return client.system.update_system({
                name: SYS2,
            });
        }).then(function() {
            return client.account.create_account({
                name: EMAIL,
                email: EMAIL,
                password: PASSWORD,
            });
        }).then(function() {
            return client.system.add_role({
                email: EMAIL,
                role: 'admin',
            });
        }).then(function() {
            return client.system.remove_role({
                email: EMAIL,
            });
        }).then(function() {
            return client.system.read_system();
        }).then(function() {
            return client.system.list_systems();
        }).then(function() {
            return client.system.delete_system();
        }).nodeify(done);
    });

});
