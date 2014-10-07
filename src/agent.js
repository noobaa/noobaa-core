/* jshint node:true */
'use strict';

var _ = require('underscore');
var assert = require('assert');
var http = require('http');
var express = require('express');
var Q = require('q');
var account_api = require('./account_api');
var edge_node_api = require('./edge_node_api');
var agent_api = require('./agent_api');

module.exports = Agent;

function Agent(params) {
    assert(params.account_client, 'missing params.account_client');
    assert(params.edge_node_client, 'missing params.edge_node_client');
    assert(params.node_name, 'missing params.node_name');
    assert(params.account_credentials, 'missing params.account_credentials');
    this.account_client = params.account_client;
    this.edge_node_client = params.edge_node_client;
    this.account_credentials = params.account_credentials;
    this.node_name = params.node_name;

    var app = express();
    var agent_server = new agent_api.Server({
        read_block: this.read_block.bind(this),
        write_block: this.write_block.bind(this),
    });
    agent_server.set_logging();
    agent_server.install_routes(app, '/agent_api/');
    this.agent_server = app;
    this.agent_app = app;

    this.blocks_in_memory = {};
}

Agent.prototype.start = function() {
    var self = this;
    return Q.fcall(function() {
        return self.account_client.login_account(self.account_credentials);
    }).then(function() {
        var defer = Q.defer();
        self.http_server = http.createServer(self.agent_app);
        self.http_server.listen(function() {
            self.http_port = self.http_server.address().port;
            console.log('listening port ' + self.http_port);
            defer.resolve();
        });
        return defer.promise;
    }).then(function() {
        return self.edge_node_client.connect_edge_node({
            name: self.node_name,
            ip: '0.0.0.0',
            port: self.http_port,
        });
    });
};

Agent.prototype.stop = function() {
    if (this.http_server) {
        this.http_server.close();
    }
    delete this.http_server;
    delete this.http_port;
};

// TODO reading from memory for now
Agent.prototype.read_block = function(req) {
    var block_id = req.restful_params.block_id;
    var block = this.blocks_in_memory[block_id];
    return {
        data: block ? block.data : ''
    };
};

// TODO writing to memory for now
Agent.prototype.write_block = function(req) {
    var block_id = req.restful_params.block_id;
    var data = req.restful_params.data;
    this.blocks_in_memory[block_id] = data;
};
