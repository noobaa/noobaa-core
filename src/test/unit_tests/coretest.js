// make jshint ignore mocha globals
'use strict';

var CORETEST_MONGODB_URL = 'mongodb://localhost/coretest';
process.env.MONGODB_URL = CORETEST_MONGODB_URL;
process.env.JWT_SECRET = 'coretest';

var _ = require('lodash');
var mocha = require('mocha');
var assert = require('assert');
var mongoose = require('mongoose');
var P = require('../../util/promise');
var config = require('../../../config.js');
var core_agent_control = require('./core_agent_control');
var server_rpc = require('../../server/server_rpc');
var nodes_store = require('../../server/node_services/nodes_store');
var mongo_client = require('../../util/mongo_client');
var mongoose_utils = require('../../util/mongoose_utils');

P.config({
    longStackTraces: true
});
config.test_mode = true;
config.NODES_FREE_SPACE_RESERVE = 10 * 1024 * 1024;

// register api servers and bg_worker servers locally too
server_rpc.register_system_services();
server_rpc.register_node_services();
server_rpc.register_object_services();
server_rpc.register_bg_services();
server_rpc.register_common_services();
server_rpc.rpc.set_request_logger(function() {
    return console.info.apply(console,
        _.map(arguments, arg => require('util').inspect(arg, {
            depth: null
        })));
});
server_rpc.rpc.router.default =
    server_rpc.rpc.router.md =
    server_rpc.rpc.router.bg =
    'fcall://fcall';

let http_port = 0;
let http_server;
let api_coverage = new Set();
let client_options = {
    tracker: req => api_coverage.delete(req.srv)
};

function new_test_client() {
    let client = server_rpc.rpc.new_client(client_options);
    return client;
}

mocha.before('coretest-before', function() {
    _.each(server_rpc.rpc._services, (service, srv) => api_coverage.add(srv));
    return P.resolve()
        .then(() => mongoose_utils.mongoose_connect())
        .then(() => mongoose_utils.mongoose_wait_connected())
        .then(() => mongoose.connection.db.dropDatabase()) // returns promise
        .then(() => mongoose_utils.mongoose_ensure_indexes())
        .then(() => mongo_client.instance().connect())
        .then(() => server_rpc.rpc.start_http_server({
            port: http_port,
            secure: false,
            logging: true,
            ws: true
        }))
        .then(http_server_arg => {
            // the http/ws port is used by the agents
            http_server = http_server_arg;
            http_port = http_server.address().port;
            console.log('CORETEST HTTP SERVER', http_port);
        });
});

var _incomplete_rpc_coverage;

mocha.after('coretest-after', function() {
    console.log('Database', CORETEST_MONGODB_URL, 'is intentionally',
        'left for debugging and will be deleted before next test run');

    if (_incomplete_rpc_coverage) {
        var had_missing = false;
        for (let srv of api_coverage) {
            console.warn('API was not covered:', srv);
            had_missing = true;
        }
        if (had_missing) {
            if (_incomplete_rpc_coverage === 'fail') {
                throw new Error('INCOMPLETE RPC COVERAGE');
            } else {
                console.warn('INCOMPLETE RPC COVERAGE');
            }
        }
    }

    return core_agent_control.cleanup_agents()
        .delay(1000)
        .then(() => server_rpc.rpc.set_disconnected_state(true))
        .then(() => mongo_client.instance().disconnect())
        .then(() => {
            mongoose.connection.removeAllListeners('disconnected');
            mongoose.connection.removeAllListeners('error');
            mongoose.connection.close();
        })
        .then(() => http_server && http_server.close());
});

function set_incomplete_rpc_coverage(type) {
    assert(!type || type === 'show' || type === 'fail',
        'set_incomplete_rpc_coverage expects "show" or "fail"');
    _incomplete_rpc_coverage = type;
}


// create some test nodes named 0, 1, 2, ..., count
function init_test_nodes(client, system, count) {
    return clear_test_nodes()
        .then(() => client.auth.create_auth({
            role: 'create_node',
            system: system
        }))
        .then(res => {
            var create_node_token = res.token;
            core_agent_control.use_local_agents(
                'ws://127.0.0.1:' + http_port,
                create_node_token);
            core_agent_control.create_agent(count);
            return core_agent_control.start_all_agents();
        })
        .then(() => client.node.sync_monitor_to_store());
}

// delete all edge nodes directly from the db
function clear_test_nodes() {
    return P.fcall(() => {
            console.log('REMOVE NODES');
            var warning_timeout = setTimeout(() => {
                console.log(
                    '\n\n\nWaiting too long?\n\n',
                    'the test got stuck on deleting nodes.',
                    'this is known when running in mocha standalone (root cause unknown).',
                    'it does work fine when running with gulp, so we let it be.\n\n');
                process.exit(1);
            }, 3000);
            return nodes_store.instance().test_code_delete_all_nodes()
                .finally(() => clearTimeout(warning_timeout));
        })
        .then(() => {
            console.log('CLEANING AGENTS');
            return core_agent_control.cleanup_agents();
        });
}

module.exports = {
    client: new_test_client(),
    new_test_client: new_test_client,
    init_test_nodes: init_test_nodes,
    clear_test_nodes: clear_test_nodes,
    set_incomplete_rpc_coverage: set_incomplete_rpc_coverage,
};

//Expose Agent Control API via coretest
_.each(core_agent_control, prop => {
    if (core_agent_control.hasOwnProperty(prop)) {
        module.exports[prop] = core_agent_control[prop];
    }
});
