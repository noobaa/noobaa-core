// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var utilitest = require('noobaa-util/utilitest');

// better stack traces for promises
// used for testing only to avoid its big mem & cpu overheads
Q.longStackSupport = true;

var account_api = require('../api/account_api');
var account_server = require('../server/account_server');
var account_client = new account_api.Client({
    path: '/account_api/',
});

var edge_node_api = require('../api/edge_node_api');
var edge_node_server = require('../server/edge_node_server');
var edge_node_client = new edge_node_api.Client({
    path: '/edge_node_api/',
});

var object_api = require('../api/object_api');
var object_server = require('../server/object_server');
var ObjectClient = require('../client/object_client');
var object_client = new ObjectClient({
    path: '/object_api/',
});

var account_credentials = {
    email: 'coretest@core.test',
    password: 'coretest',
};

before(function(done) {
    Q.fcall(
        function() {
            account_server.set_logging();
            account_server.install_routes(utilitest.router, '/account_api/');
            account_client.set_param('port', utilitest.http_port());

            edge_node_server.set_logging();
            edge_node_server.install_routes(utilitest.router, '/edge_node_api/');
            edge_node_client.set_param('port', utilitest.http_port());

            object_server.set_logging();
            object_server.install_routes(utilitest.router, '/object_api/');
            object_client.set_param('port', utilitest.http_port());

            return account_client.create_account(account_credentials);
        }
    ).nodeify(done);
});

after(function() {
    account_server.disable_routes();
    edge_node_server.disable_routes();
});

function login_default_account() {
    return account_client.login_account(account_credentials);
}

module.exports = {
    account_credentials: account_credentials,
    login_default_account: login_default_account,
    account_client: account_client,
    edge_node_client: edge_node_client,
    object_client: object_client,
};
