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
var config = require('../../config.js');
// var dbg = require('noobaa-util/debug_module')(__filename);

var agentctl = require('./core_agent_control');

// better stack traces for promises
// used for testing only to avoid its big mem & cpu overheads
Q.longStackSupport = true;

process.env.JWT_SECRET = 'coretest';

var account_credentials = {
    email: 'coretest@core.test',
    password: 'coretest',
};

var client = new api.Client();

// register api servers
require('../server/server_rpc');

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

        config.test_mode = true;

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
            agentctl.use_local_agents(utilitest, create_node_token);
            var sem = new Semaphore(3);
            return Q.all(_.times(count, function(i) {
                    return sem.surround(function() {
                        agentctl.create_agent(1);
                    });
                }))
                .then(function() {
                    return agentctl.start_all_agents();
                });
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
            console.log('STOPING AGENTS');
            return Q.fcall(function() {
                return agentctl.stop_all_agents();
            });
        })
        .then(function() {
            console.log('CLEANING AGENTS');
            return Q.fcall(function() {
                return agentctl.cleanup_agents();
            });
        });
}

module.exports = {
    //Own API
    account_credentials: account_credentials,
    client: client,

    new_client: function() {
        return new api.Client(client.options);
    },

    init_test_nodes: init_test_nodes,
    clear_test_nodes: clear_test_nodes,
};

//Expose Agent Control API via coretest
_.each(agentctl, function(prop) {
    if (agentctl.hasOwnProperty(prop)) {
        module.exports[prop] = agentctl[prop];
    }
});
