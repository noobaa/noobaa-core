/* jshint node:true */
'use strict';

var _ = require('lodash');
var assert = require('assert');
var http = require('http');
var express = require('express');
var Q = require('q');
var account_api = require('../api/account_api');
var edge_node_api = require('../api/edge_node_api');
var agent_api = require('../api/agent_api');

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

    var http_server = http.createServer(app);
    http_server.on('listening', this.server_listening_handler.bind(this));
    http_server.on('close', this.server_close_handler.bind(this));
    http_server.on('error', this.server_error_handler.bind(this));

    this.agent_app = app;
    this.agent_server = agent_server;
    this.http_server = http_server;
    this.http_port = 0;

    this.blocks_in_memory = {};
    this.space_total = 10 * 1024 * 1024; // TODO maintain space_total
    this.space_used = 0;
    this.num_blocks = 0;
}

Agent.prototype.start = function() {
    var self = this;

    self.is_started = true;

    return Q.fcall(function() {
        return self.account_client.login_account(self.account_credentials);

    }).then(function() {
        self.start_stop_http_server();

    }).then(function() {
        return self.edge_node_client.connect_edge_node({
            name: self.node_name,
            ip: '0.0.0.0',
            port: self.http_port,
        });

    }).then(function() {
        self.start_stop_heartbeats();

    }).then(null, function(err) {
        console.error('AGENT server failed to start', err);
        self.stop();
        throw err;
    });
};

Agent.prototype.stop = function() {
    this.is_started = false;
    this.start_stop_http_server();
    this.start_stop_heartbeats();
};


/////////////////
// HTTP SERVER //
/////////////////

Agent.prototype.start_stop_http_server = function() {
    if (this.is_started) {
        // using port to determine if the server is already listening
        if (!this.http_port) {
            this.http_server.listen();
        }
    } else {
        if (this.http_port) {
            this.http_server.close();
        }
    }
};

Agent.prototype.server_listening_handler = function() {
    this.http_port = this.http_server.address().port;
    console.log('AGENT server listening on port', this.http_port);
};

Agent.prototype.server_close_handler = function() {
    console.log('AGENT server closed');
    this.http_port = 0;
    // set timer to check the state and react by restarting or not
    setTimeout(this.start_stop_http_server.bind(this), 1000);
};

Agent.prototype.server_error_handler = function(err) {
    // the server will also trigger close event after
    console.error('AGENT server error', err);
};



////////////////
// HEARTBEATS //
////////////////

Agent.prototype.start_stop_heartbeats = function() {
    // first clear the timer
    clearInterval(this.heartbeat_interval);
    this.heartbeat_interval = null;
    // set the timer when started
    if (this.is_started) {
        this.heartbeat_interval =
            setInterval(this.send_heartbeat.bind(this), 60000);
    }
};


Agent.prototype.send_heartbeat = function() {
    return this.edge_node_client.heartbeat({
        space_total: this.space_total,
        space_used: this.space_used,
        num_blocks: this.num_blocks,
    });
};



///////////////
// AGENT API //
///////////////

Agent.prototype.read_block = function(req) {
    // TODO reading from memory for now
    var block_id = req.restful_params.block_id;
    var block = this.blocks_in_memory[block_id];
    return {
        data: block ? block.data : ''
    };
};

Agent.prototype.write_block = function(req) {
    // TODO writing to memory for now
    var block_id = req.restful_params.block_id;
    var data = req.restful_params.data;
    var block = this.blocks_in_memory[block_id];

    if (!block) {
        block = {
            data: ''
        };
        this.blocks_in_memory[block_id] = block;
        this.num_blocks += 1;
    }
    this.space_used -= block.data.length;
    this.space_used += data.length;
    block.data = data;
};
