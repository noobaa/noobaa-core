// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('underscore');
var Q = require('q');
var assert = require('assert');
var coretest = require('./coretest');
var Agent = require('./agent');
var agent_api = require('./agent_api');

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
            return agent.send_heartbeat();
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
                console.log('agent start', agent.node_name);
                return agent.start();
            }));
        }).then(function() {
            /*
            var agent_client = new agent_api.Client({
                path: '/agent_api/',
                port: 0,
            });
            */
        }).then(function() {
            return Q.all(_.map(agents, function(agent) {
                console.log('agent stop', agent.node_name);
                return agent.stop();
            }));
        });
    });

});
