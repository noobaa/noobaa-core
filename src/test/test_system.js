// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var coretest = require('./coretest');

describe('system', function() {

    var system_client = coretest.system_client;
    var SYS1 = 'test-system-1';
    var SYS2 = 'test-system-2';
    var EMAIL = 'test-system@test.test';
    var PASSWORD = 'test-system-password';

    it('crud', function(done) {
        var system_id;
        Q.fcall(function() {
            return system_client.create_system({
                name: SYS1,
            });
        }).then(function() {
            // authenticate now with the new system
            return coretest.create_auth({
                system: SYS1
            });
        }).then(function() {
            return system_client.read_system();
        }).then(function() {
            return system_client.update_system({
                name: SYS2,
            });
        }).then(function() {
            return coretest.account_client.create_account({
                name: EMAIL,
                email: EMAIL,
                password: PASSWORD,
            });
        }).then(function() {
            return system_client.add_role({
                email: EMAIL,
                role: 'admin',
            });
        }).then(function() {
            return system_client.remove_role({
                email: EMAIL,
            });
        }).then(function() {
            return coretest.tier_client.create_tier({
                name: 'edge',
                kind: 'edge',
            });
        }).then(function() {
            return coretest.tier_client.delete_tier({
                name: 'edge',
            });
        }).then(function() {
            return system_client.read_system();
        }).then(function() {
            return system_client.list_systems();
        }).then(function() {
            return system_client.delete_system();
        }).nodeify(done);
    });

});
