// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var size_utils = require('../util/size_utils');

describe('edge_node_api', function() {

    var coretest = require('./coretest');


    it('works', function(done) {
        Q.fcall(function() {
            return coretest.login_default_account();
        }).then(function() {
            return coretest.edge_node_client.create_node({
                name: 'haha',
                geolocation: 'home',
                allocated_storage: 10 * size_utils.GIGABYTE,
            });
        }).then(function() {
            return coretest.edge_node_client.heartbeat({
                name: 'haha',
                geolocation: 'home',
                ip: '0.0.0.0',
                port: 0,
                allocated_storage: 10 * size_utils.GIGABYTE,
                used_storage: size_utils.GIGABYTE,
            });
        }).then(function() {
            return coretest.edge_node_client.read_node({
                name: 'haha',
            });
        }).then(function() {
            return coretest.edge_node_client.list_nodes();
        }).then(function() {
            return coretest.edge_node_client.delete_node({
                name: 'haha',
            });
        }).nodeify(done);
    });


});
