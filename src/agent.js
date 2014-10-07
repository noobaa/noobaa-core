/* jshint node:true */
'use strict';

var _ = require('underscore');
var assert = require('assert');
var http = require('http');
var express = require('express');
var Q = require('q');
var account_api = require('./account_api');
var edge_node_api = require('./edge_node_api');

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
}

Agent.prototype.start = function() {
    var self = this;
    return Q.fcall(function() {
        return self.account_client.login_account(self.account_credentials);
    }).then(function() {
        var defer = Q.defer();
        var app = express();
        self.server = http.createServer(app);
        self.server.listen(function() {
            self.port = self.server.address().port;
            console.log('listening port ' + self.port);
            defer.resolve();
        });
        return defer.promise;
    }).then(function() {
        return self.edge_node_client.connect_edge_node({
            name: self.node_name,
            ip: '0.0.0.0',
            port: self.port,
        });
    });
};

Agent.prototype.stop = function() {
    if (this.server) {
        this.server.close();
        delete this.server;
        delete this.port;
    }
};

