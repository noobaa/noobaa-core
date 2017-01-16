/* Copyright (C) 2016 NooBaa */
'use strict';

console.log('loading .env file');
require('../../util/dotenv').load();

process.env.JWT_SECRET = 'coretest';
process.env.MONGODB_URL =
    process.env.CORETEST_MONGODB_URL =
    process.env.CORETEST_MONGODB_URL || 'mongodb://localhost/coretest';

const config = require('../../../config.js');
config.test_mode = true;
config.NODES_FREE_SPACE_RESERVE = 10 * 1024 * 1024;

const P = require('../../util/promise');
P.config({
    longStackTraces: true
});

const _ = require('lodash');
const util = require('util');
const mocha = require('mocha');
const assert = require('assert');
const mongoose = require('mongoose');

const api = require('../../api');
const server_rpc = require('../../server/server_rpc');
const NodesStore = require('../../server/node_services/nodes_store').NodesStore;
const node_server = require('../../server/node_services/node_server');
const mongo_client = require('../../util/mongo_client');
const mongoose_utils = require('../../util/mongoose_utils');
const core_agent_control = require('./core_agent_control');

let base_address;
let http_server;
let _setup = false;
let _incomplete_rpc_coverage;
const api_coverage = new Set();
const client_options = {
    tracker: req => api_coverage.delete(req.srv)
};

function setup({ incomplete_rpc_coverage } = {}) {
    if (_setup) return;
    _setup = true;

    if (incomplete_rpc_coverage) {
        assert(incomplete_rpc_coverage === 'show' || incomplete_rpc_coverage === 'fail',
            'coretest: incomplete_rpc_coverage expected value "show" or "fail"');
        _incomplete_rpc_coverage = incomplete_rpc_coverage;
    }

    api.get_base_address = () => 'fcall://fcall';

    // register api servers and bg_worker servers locally too
    server_rpc.register_system_services();
    server_rpc.register_node_services();
    server_rpc.register_object_services();
    server_rpc.register_func_services();
    server_rpc.register_bg_services();
    server_rpc.register_hosted_agents_services();
    server_rpc.register_common_services();
    server_rpc.rpc.set_request_logger(function() {
        return console.info.apply(console,
            _.map(arguments, arg => util.inspect(arg, {
                depth: null
            })));
    });
    _.each(server_rpc.rpc.router, (val, key) => {
        server_rpc.rpc.router[key] = 'fcall://fcall';
    });
    _.each(server_rpc.rpc._services,
        (service, srv) => api_coverage.add(srv));

    mocha.before('coretest-before', function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(10000);
        return P.resolve()
            .then(() => console.log('running mongoose_utils.mongoose_connect()'))
            .then(() => mongoose_utils.mongoose_connect())
            .then(() => console.log('running mongoose_utils.mongoose_wait_connected()'))
            .then(() => mongoose_utils.mongoose_wait_connected())
            .then(() => console.log('running mongoose.connection.db.dropDatabase()'))
            .then(() => mongoose.connection.db.dropDatabase()) // returns promise
            .then(() => console.log('running mongoose_utils.mongoose_ensure_indexes()'))
            .then(() => mongoose_utils.mongoose_ensure_indexes())
            .then(() => console.log('running mongo_client.instance().connect()'))
            .then(() => mongo_client.instance().connect())
            .then(() => console.log('running server_rpc.rpc.start_http_server'))
            .then(() => server_rpc.rpc.start_http_server({
                port: 0,
                protocol: 'ws:',
                logging: true,
            }))
            .then(http_server_arg => {
                // the http/ws port is used by the agents
                http_server = http_server_arg;
                const http_port = http_server.address().port;
                console.log('CORETEST HTTP SERVER', http_port);
                base_address = `ws://127.0.0.1:${http_port}`;

                // update the nodes_monitor n2n_rpc to find the base_address correctly for signals
                node_server.get_local_monitor().n2n_rpc.router.default = base_address;
                node_server.get_local_monitor().n2n_rpc.router.master = base_address;
            });
    });


    mocha.after('coretest-after', function() {
        console.log('Database', process.env.CORETEST_MONGODB_URL, 'is intentionally',
            'left for debugging and will be deleted before next test run');

        if (_incomplete_rpc_coverage) {
            let had_missing = false;
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

}

function new_test_client() {
    const client = server_rpc.rpc.new_client(client_options);
    return client;
}

// create some test nodes named 0, 1, 2, ..., count
function init_test_nodes(client, system, count) {
    return clear_test_nodes()
        .then(() => client.auth.create_auth({
            role: 'create_node',
            system: system
        }))
        .then(res => {
            const create_node_token = res.token;
            core_agent_control.use_local_agents(base_address, create_node_token);
            core_agent_control.create_agent(count);
            return core_agent_control.start_all_agents();
        })
        .then(() => console.log(`created ${count} agents`))
        .then(() => client.node.sync_monitor_to_store())
        .then(() => P.delay(2000))
        .then(() => client.node.sync_monitor_to_store());
}

// delete all edge nodes directly from the db
function clear_test_nodes() {
    return P.resolve()
        .then(() => console.log('REMOVE NODES'))
        .then(() => NodesStore.instance().test_code_delete_all_nodes())
        .then(() => console.log('CLEANING AGENTS'))
        .then(() => core_agent_control.cleanup_agents());
}

exports.setup = setup;
exports.client = new_test_client();
exports.new_test_client = new_test_client;
exports.init_test_nodes = init_test_nodes;
exports.clear_test_nodes = clear_test_nodes;
