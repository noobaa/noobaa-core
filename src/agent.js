/* jshint node:true */
'use strict';

var _ = require('underscore');
var account_api = require('./account_api');
var edge_node_api = require('./edge_node_api');

var client_params = {
    port: 5000,
};
var account_client = new account_api.Client(_.extend({
    path: '/account_api/'
}, client_params));
var edge_node_client = new edge_node_api.Client(_.extend({
    path: '/edge_node_api/'
}, client_params));

// TODO

account_client.login({
	email: 'bla@bla.bla',
	password: 'bla',
});

