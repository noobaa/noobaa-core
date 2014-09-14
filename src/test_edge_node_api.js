// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('underscore');
var Q = require('q');
var assert = require('assert');

describe('edge_node_api', function() {

    var coretest = require('./coretest');


    it('works', function(done) {
        Q.fcall(function() {
            return coretest.login_default_account();
        }).then(function() {
            return coretest.edge_node_client.connect_edge_node({
                name: 'haha',
                ip: '0.0.0.0',
                port: 9999,
            });
        }).then(function() {
            return coretest.edge_node_client.connect_edge_node({
                name: 'haha',
                ip: '0.0.0.0',
                port: 9999,
            });
        }).then(function() {
            return coretest.edge_node_client.delete_edge_node({
                name: 'haha',
            });
        }).then(function() {
            return coretest.edge_node_client.connect_edge_node({
                name: 'haha',
                ip: '0.0.0.0',
                port: 9999,
            });
        }).nodeify(done);
    });


});
