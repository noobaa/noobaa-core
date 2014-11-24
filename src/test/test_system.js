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
            return coretest.account_auth({
                system: system_id
            });
        }).then(function() {
            return system_client.read_system();
        }).then(function() {
            return system_client.update_system({
                name: 'sys2',
            });
        }).then(function() {
            return system_client.delete_system();
        }).nodeify(done);
    });

});
