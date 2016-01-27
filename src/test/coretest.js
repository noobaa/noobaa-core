// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
/* exported describe, it, before, after, beforeEach, afterEach */
'use strict';

var CORETEST_MONGODB_URL = 'mongodb://localhost/coretest';
process.env.MONGODB_URL = CORETEST_MONGODB_URL;
process.env.DEBUG_MODE === 'true';
process.env.JWT_SECRET = 'coretest';

var _ = require('lodash');
var P = require('../util/promise');
var mongoose = require('mongoose');
var Semaphore = require('../util/semaphore');
var api = require('../api');
var server_rpc = require('../server/server_rpc');
var bg_workers_rpc = require('../bg_workers/bg_workers_rpc');
var mongo_client = require('../server/stores/mongo_client');
var nodes_store = require('../server/stores/nodes_store');
var config = require('../../config.js');
var db = require('../server/db');
// var dbg = require('../util/debug_module')(__filename);
var agentctl = require('./core_agent_control');


config.test_mode = true;
// register api servers and bg_worker servers locally too
server_rpc.register_servers();
bg_workers_rpc.register_own_servers();

// redirect all rpc calls using local function calls
bg_workers_rpc.server_rpc.base_address =
    api.bg_workers_client.options.address =
    api.rpc.base_address =
    'fcall://fcall';

let client = api.rpc.client;
let api_coverage = new Set();
client.options = client.options || {};
api.rpc.set_request_logger(console.info);

before(function(done) {
    _.each(api.rpc._services, (service, srv) => api_coverage.add(srv));
    client.options.tracker = req => api_coverage.delete(req.srv);
    P.fcall(() => db.mongoose_connect())
        .then(() => db.mongoose_wait_connected())
        .then(() => P.npost(mongoose.connection.db, 'dropDatabase'))
        .then(() => db.mongoose_ensure_indexes())
        .then(() => mongo_client.connect())
        .nodeify(done);
});

after(function() {
    for (let srv of api_coverage) {
        console.warn('API was not covered:', srv);
    }
    console.log('Database', CORETEST_MONGODB_URL, 'is intentionally',
        'left for debugging and will be deleted before next test run');
});


// create some test nodes named 0, 1, 2, ..., count
function init_test_nodes(count, system, tier) {
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
            agentctl.use_local_agents(api.rpc.base_address, create_node_token);
            var sem = new Semaphore(3);
            return P.all(_.times(count, function(i) {
                    return sem.surround(function() {
                        return agentctl.create_agent(1);
                    });
                }))
                .then(function() {
                    return agentctl.start_all_agents();
                });
        });
}

// delete all edge nodes directly from the db
function clear_test_nodes() {
    return P.fcall(function() {
            console.log('REMOVE NODES');
            var warning_timeout = setTimeout(function() {
                console.log(
                    '\n\n\nWaiting too long?\n\n',
                    'the test got stuck on deleting nodes.',
                    'this is known when running in mocha standalone (root cause unknown).',
                    'it does work fine when running with gulp, so we let it be.\n\n');
                process.exit(1);
            }, 3000);
            return nodes_store.test_code_delete_all_nodes()
                .finally(function() {
                    clearTimeout(warning_timeout);
                });
        }).then(function() {
            console.log('STOPING AGENTS');
            return P.fcall(function() {
                return agentctl.stop_all_agents();
            });
        })
        .then(function() {
            console.log('CLEANING AGENTS');
            return P.fcall(function() {
                return agentctl.cleanup_agents();
            });
        });
}

module.exports = {
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
