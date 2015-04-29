// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
/* exported describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('lodash');
var Q = require('q');
var mongoose = require('mongoose');
var Semaphore = require('noobaa-util/semaphore');
var api = require('../api');
var db = require('../server/db');
var Agent = require('../agent/agent');
var config = require('../../config.js');
// var dbg = require('noobaa-util/debug_module')(__filename);

// better stack traces for promises
// used for testing only to avoid its big mem & cpu overheads
// Q.longStackSupport = true;

process.env.JWT_SECRET = 'coretest';

var account_credentials = {
    email: 'coretest@core.test',
    password: 'coretest',
};

var client = new api.Client();

// register api servers
require('../server/api_servers');

_.each(mongoose.modelNames(), function(model_name) {
    mongoose.model(model_name).schema.set('autoIndex', false);
});

var utilitest = require('noobaa-util/utilitest');


before(function(done) {
    Q.fcall(function() {
        // after dropDatabase() we need to recreate the indexes
        // otherwise we get "MongoError: ns doesn't exist"
        // see https://github.com/LearnBoost/mongoose/issues/2671
        // TODO move this to utilitest
        return Q.all(_.map(mongoose.modelNames(), function(model_name) {
            return Q.npost(mongoose.model(model_name), 'ensureIndexes');
        }));
    }).then(function() {

        // use http only for test
        config.use_ws_when_possible = false;
        config.use_ice_when_possible = false;
        client.options.port = utilitest.http_port();

        var account_params = _.clone(account_credentials);
        account_params.name = 'coretest';
        return client.account.create_account(account_params);
    }).then(function() {
        return client.create_auth_token(account_credentials);
    }).nodeify(done);
});

after(function() {
    // place for cleanups
});


var test_agents;


// create some test nodes named 0, 1, 2, ..., count
function init_test_nodes(count, system, tier, storage_alloc) {
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
            var create_node_token = res.token;
            var sem = new Semaphore(3);
            return Q.all(_.times(count, function(i) {
                return sem.surround(function() {
                    var agent = new Agent({
                        address: 'ws://localhost:' + utilitest.http_port(),
                        node_name: 'node' + i + '_' + Date.now(),
                        // passing token instead of storage_path to use memory storage
                        token: create_node_token,
                        use_http_server: true,
                    });
                    return agent.start().thenResolve(agent);
                });
            }));
        })
        .then(function(agents) {
            test_agents = agents;
        });
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
    });
}



module.exports = {
    account_credentials: account_credentials,
    client: client,

    new_client: function() {
        return new api.Client(client.options);
    },

    init_test_nodes: init_test_nodes,
    clear_test_nodes: clear_test_nodes,
};
