// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var coretest = require('./coretest');

describe('system', function() {

    var system_client = coretest.system_client;

    it('crud', function(done) {
        var system_id;
        Q.fcall(function() {
            return system_client.create_system({
                name: 'sys1',
            });
        }).then(function(res) {
            system_id = res.id;
            // authenticate now with the new system
            return coretest.create_auth({
                system: system_id
            });
        }).then(function() {
            return system_client.read_system();
        }).then(function() {
            return system_client.update_system({
                name: 'sys2',
            });
        }).then(function() {
            return coretest.account_client.create_account({
                name: 'role tester',
                email: 'role@test.er',
                password: 'roletester',
            });
        }).then(function() {
            return system_client.add_role({
                email: 'role@test.er',
                role: 'admin',
            });
        }).then(function() {
            return system_client.remove_role({
                email: 'role@test.er',
            });
        }).then(function() {
            return system_client.add_vendor({
                name: 'me',
                category: 'vm',
                kind: 'agent_host',
                details: {
                    email: 'me@me.me'
                },
            });
        }).then(function() {
            return system_client.remove_vendor({
                name: 'me',
            });
        }).then(function() {
            return system_client.add_tier({
                name: 'tier',
            });
        }).then(function() {
            return system_client.remove_tier({
                name: 'tier',
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
