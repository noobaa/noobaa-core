/* jshint node:true */
'use strict';

var _ = require('underscore');
var assert = require('assert');
var Q = require('q');
var account_api = require('./account_api');
var edge_node_api = require('./edge_node_api');

module.exports = Agent;

function Agent(params) {
    this.params = params;
    assert(this.params.account_login, 'missing params.account_login');
    assert(this.params.node_name, 'missing params.node_name');

    var client_params = _.pick(params, 'hostname', 'port');

    this.account_client = new account_api.Client(_.extend({
        path: '/account_api/'
    }, client_params));

    this.edge_node_client = new edge_node_api.Client(_.extend({
        path: '/edge_node_api/'
    }, client_params));
}

Agent.prototype.connect = function() {
    var self = this;
    return Q.fcall(function() {
        return self.account_client.login(self.params.account_login);
    }).then(function() {
        return self.edge_node_client.connect_edge_node({
            name: self.params.node_name,
            ip: '0.0.0.0',
            port: 9999,
        });
    });
};
