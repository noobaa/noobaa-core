// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var path = require('path');
var utilitest = require('noobaa-util/utilitest');
var rimraf = require('rimraf');
var Semaphore = require('noobaa-util/semaphore');
var db = require('../server/db');
var Agent = require('../agent/agent');

// better stack traces for promises
// used for testing only to avoid its big mem & cpu overheads
Q.longStackSupport = true;

var account_credentials = {
    email: 'coretest@core.test',
    password: 'coretest',
};
var account_api = require('../api/account_api');
var account_server = require('../server/account_server');
var account_client = new account_api.Client();

var system_api = require('../api/system_api');
var system_server = require('../server/system_server');
var system_client = new system_api.Client();

var edge_node_api = require('../api/edge_node_api');
var edge_node_server = require('../server/edge_node_server');
var edge_node_client = new edge_node_api.Client();

var object_api = require('../api/object_api');
var object_server = require('../server/object_server');
var ObjectClient = require('../api/object_client');
var object_client = new ObjectClient();


before(function(done) {
    Q.fcall(
        function() {
            account_server.install_routes(utilitest.router);
            system_server.install_routes(utilitest.router);
            edge_node_server.install_routes(utilitest.router);
            object_server.install_routes(utilitest.router);

            account_client.set_param('port', utilitest.http_port());
            system_client.set_param('port', utilitest.http_port());
            edge_node_client.set_param('port', utilitest.http_port());
            object_client.set_param('port', utilitest.http_port());

            return account_client.create_account(_.merge({
                name: 'coretest'
            }, account_credentials));
        }
    ).nodeify(done);
});

after(function() {
    account_server.disable_routes();
    system_server.disable_routes();
    edge_node_server.disable_routes();
    object_server.disable_routes();
});

function login_default_account() {
    return account_client.login_account(account_credentials);
}

var test_agents;
var agent_storage_dir = path.resolve(__dirname, '../../test_data/coretest');


// create some test nodes named 0, 1, 2, ..., count
function init_test_nodes(count, allocated_storage) {
    var sem = new Semaphore(3);

    function init_test_node(i) {
        return Q.fcall(
            function() {
                return edge_node_client.create_node({
                    name: '' + i,
                    geolocation: 'test',
                    allocated_storage: allocated_storage,
                });
            }
        ).then(
            function() {
                var agent = new Agent({
                    system_client: system_client,
                    edge_node_client: edge_node_client,
                    account_credentials: account_credentials,
                    node_name: '' + i,
                    node_geolocation: 'test',
                    storage_path: agent_storage_dir,
                });
                return agent.start().thenResolve(agent);
            }
        );
    }

    return clear_test_nodes().then(
        function() {
            return Q.all(_.times(count, function(i) {
                return sem.surround(function() {
                    return init_test_node(i);
                });
            }));
        }
    ).then(
        function(agents) {
            test_agents = agents;
        }
    );
}

// delete all edge nodes directly from the db
function clear_test_nodes() {
    return Q.fcall(
        function() {
            console.log('REMOVE NODES');
            var warning_timeout = setTimeout(function() {
                console.log(
                    '\n\n\nWaiting too long?\n\n',
                    'the test got stuck on db.Node.remove().',
                    'this is known when running in mocha standalone (root cause unknown).',
                    'it does work fine when running with gulp, so we let it be.\n\n');
                process.exit(1);
            }, 3000);
            return Q.when(db.Node.remove().exec())['finally'](
                function() {
                    clearTimeout(warning_timeout);
                }
            );
        }
    ).then(
        function() {
            if (!test_agents) {
                return;
            }
            console.log('STOPING AGENTS');
            var sem = new Semaphore(3);
            return Q.all(_.map(test_agents,
                function(agent) {
                    return sem.surround(function() {
                        console.log('agent stop', agent.node_name);
                        return agent.stop();
                    });
                }
            )).then(
                function() {
                    test_agents = null;
                }
            );
        }
    ).then(
        function() {
            console.log('RIMRAF', agent_storage_dir);
            return Q.nfcall(rimraf, agent_storage_dir);
        }
    );
}



module.exports = {
    account_client: account_client,
    account_credentials: account_credentials,
    login_default_account: login_default_account,

    system_client: system_client,
    edge_node_client: edge_node_client,
    object_client: object_client,

    init_test_nodes: init_test_nodes,
    clear_test_nodes: clear_test_nodes,
};
