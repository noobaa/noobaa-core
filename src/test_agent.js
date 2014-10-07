// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('underscore');
var Q = require('q');
var assert = require('assert');
var coretest = require('./coretest');
var Agent = require('./agent');

describe('agent', function() {

    it('should start single agent', function() {
        var agent = new Agent({
            account_client: coretest.account_client,
            edge_node_client: coretest.edge_node_client,
            account_credentials: coretest.account_credentials,
            node_name: 'a',
        });
        return agent.start();
    });

    it('should start multiple agents', function() {
        var nodes = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
        var agents = [];
        return Q.all(_.map(nodes, function(node_name, i) {
            console.log('start agent', i);
            agents[i] = new Agent({
                account_client: coretest.account_client,
                edge_node_client: coretest.edge_node_client,
                account_credentials: coretest.account_credentials,
                node_name: node_name,
            });
            return agents[i].start();
        })).then(function() {
            _.each(nodes, function(node_name, i) {
            	console.log('stop agent', i);
                agents[i].stop();
            });
        });
    });

});
