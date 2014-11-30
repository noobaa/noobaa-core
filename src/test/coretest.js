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
var api = require('../api');
var db = require('../server/db');
var Agent = require('../agent/agent');

// better stack traces for promises
// used for testing only to avoid its big mem & cpu overheads
// Q.longStackSupport = true;

process.env.JWT_SECRET = 'coretest';

var account_credentials = {
    email: 'coretest@core.test',
    password: 'coretest',
};

var auth_server = require('../server/auth_server');
var account_server = require('../server/account_server');
var system_server = require('../server/system_server');
var tier_server = require('../server/tier_server');
var node_server = require('../server/node_server');
var bucket_server = require('../server/bucket_server');
var object_server = require('../server/object_server');

var client = new api.Client();


before(function(done) {
    Q.fcall(function() {
        utilitest.router.use(auth_server.authorize());
        auth_server.install_rest(utilitest.router);
        account_server.install_rest(utilitest.router);
        system_server.install_rest(utilitest.router);
        tier_server.install_rest(utilitest.router);
        node_server.install_rest(utilitest.router);
        bucket_server.install_rest(utilitest.router);
        object_server.install_rest(utilitest.router);

        // setting the port globally for all the clients
        api.rest_api.global_client_options.port = utilitest.http_port();
        // client.set_option('port', utilitest.http_port());

        var account_params = _.clone(account_credentials);
        account_params.name = 'coretest';
        return client.account.create_account(account_params);
    }).then(function() {
        return client.create_auth(account_credentials);
    }).nodeify(done);
});

after(function() {
    auth_server.disable_rest();
    account_server.disable_rest();
    system_server.disable_rest();
    tier_server.disable_rest();
    node_server.disable_rest();
    bucket_server.disable_rest();
    object_server.disable_rest();
});


var test_agents;
var agent_storage_dir = path.resolve(__dirname, '../../test_data/coretest');


// create some test nodes named 0, 1, 2, ..., count
function init_test_nodes(count, system, tier, storage_alloc) {
    var sem = new Semaphore(3);

    // create temp client to set token
    var create_node_client = new api.node_api.Client();

    return clear_test_nodes()
        .then(function() {
            return client.auth.create_auth({
                role: 'create_node',
                system: system,
                extra: {
                    tier: tier
                }
            });
        })
        .then(function(res) {
            create_node_client.set_auth_header(res.token);
            return Q.all(_.times(count, function(i) {
                return sem.surround(function() {
                    return init_test_node(i);
                });
            }));
        })
        .then(function(agents) {
            test_agents = agents;
        });


    function init_test_node(i) {
        return create_node_client.create_node({
                name: '' + i,
                tier: tier,
                geolocation: 'test',
                storage_alloc: storage_alloc,
            })
            .then(function(res) {
                var agent = new Agent({
                    hostname: 'localhost',
                    port: utilitest.http_port(),
                    token: res.token,
                    node_id: res.id,
                    geolocation: 'test',
                    // storage_path: agent_storage_dir,
                });
                return agent.start().thenResolve(agent);
            });
    }
}

// delete all edge nodes directly from the db
function clear_test_nodes() {
    return Q.fcall(function() {
        console.log('REMOVE NODES');
        var warning_timeout = setTimeout(function() {
            console.log(
                '\n\n\nWaiting too long?\n\n',
                'the test got stuck on db.Node.remove().',
                'this is known when running in mocha standalone (root cause unknown).',
                'it does work fine when running with gulp, so we let it be.\n\n');
            process.exit(1);
        }, 3000);
        return Q.when(db.Node.remove().exec())['finally'](function() {
            clearTimeout(warning_timeout);
        });
    }).then(function() {
        if (!test_agents) return;
        console.log('STOPING AGENTS');
        var sem = new Semaphore(3);
        return Q.all(_.map(test_agents, function(agent) {
            return sem.surround(function() {
                console.log('agent stop', agent.node_id);
                return agent.stop();
            });
        })).then(function() {
            test_agents = null;
        });
    }).then(function() {
        console.log('RIMRAF', agent_storage_dir);
        return Q.nfcall(rimraf, agent_storage_dir);
    });
}



module.exports = {
    utilitest: utilitest,
    router: utilitest.router,
    http_port: utilitest.http_port, // function
    client: function() {
        return new api.Client(client);
    },
    account_credentials: account_credentials,

    init_test_nodes: init_test_nodes,
    clear_test_nodes: clear_test_nodes,
};
