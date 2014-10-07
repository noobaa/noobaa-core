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
        var agent;
        Q.fcall(function() {
            agent = new Agent({
                account_client: coretest.account_client,
                edge_node_client: coretest.edge_node_client,
                account_credentials: coretest.account_credentials,
                node_name: 'a',
            });
            return agent.start();
        }).then(function() {
            return agent.stop();
        });
    });

    it('should start multiple agents', function() {
        var agents;
        Q.fcall(function() {
            agents = _.times(10, function(i) {
                return new Agent({
                    account_client: coretest.account_client,
                    edge_node_client: coretest.edge_node_client,
                    account_credentials: coretest.account_credentials,
                    node_name: 'node' + i,
                });
            });
        }).then(function() {
            return Q.all(_.map(agents, function(agent) {
                console.log('start agent', agent.node_name);
                return agent.start();
            }));
        }).then(function() {
            return Q.all(_.map(agents, function(agent) {
                console.log('stop agent', agent.node_name);
                return agent.stop();
            }));
        });
    });

});
