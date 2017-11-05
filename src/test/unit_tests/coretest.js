/* Copyright (C) 2016 NooBaa */
'use strict';

console.log('loading .env file');
require('../../util/dotenv').load();

const CORETEST = 'coretest';
process.env.JWT_SECRET = CORETEST;
process.env.CORETEST_MONGODB_URL = process.env.CORETEST_MONGODB_URL || `mongodb://localhost/${CORETEST}`;
process.env.MONGODB_URL = process.env.CORETEST_MONGODB_URL;

const config = require('../../../config.js');
const system_store = require('../../server/system_services/system_store').get_instance();

config.test_mode = true;
config.NODES_FREE_SPACE_RESERVE = 10 * 1024 * 1024;

const P = require('../../util/promise');
P.config({
    longStackTraces: true
});

const _ = require('lodash');
// const util = require('util');
const mocha = require('mocha');
const assert = require('assert');
// const mongodb = require('mongodb');

const api = require('../../api');
const dbg = require('../../util/debug_module')(__filename);
const endpoint = require('../../endpoint/endpoint');
const server_rpc = require('../../server/server_rpc');
const node_server = require('../../server/node_services/node_server');
const mongo_client = require('../../util/mongo_client');
const account_server = require('../../server/system_services/account_server');
const core_agent_control = require('./core_agent_control');
const { NodesStore } = require('../../server/node_services/nodes_store');

if (process.argv.includes('--verbose')) {
    dbg.set_level(5, 'core');
}

let base_address;
let http_address;
let http_server;
let _setup = false;
let _incomplete_rpc_coverage;
const api_coverage = new Set();
const rpc_client = server_rpc.rpc.new_client({
    tracker: req => api_coverage.delete(req.srv)
});

const SYSTEM = CORETEST;
const EMAIL = `${CORETEST}@noobaa.com`;
const PASSWORD = CORETEST;

function new_rpc_client() {
    return server_rpc.rpc.new_client(rpc_client.options);
}

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
    server_rpc.rpc.set_request_logger(() => dbg.log1.apply(dbg, arguments));
    _.each(server_rpc.rpc.router, (val, key) => {
        server_rpc.rpc.router[key] = 'fcall://fcall';
    });
    _.each(server_rpc.rpc._services,
        (service, srv) => api_coverage.add(srv));

    const endpoint_request_handler = endpoint.create_endpoint_handler(server_rpc.rpc, {
        s3: true,
        blob: true,
        lambda: true,
        n2n_agent: false, // we use n2n_proxy
    });

    function announce(msg) {
        const l = Math.max(80, msg.length + 4);
        console.log('='.repeat(l));
        console.log('=' + ' '.repeat(l - 2) + '=');
        console.log('= ' + msg + ' '.repeat(l - msg.length - 3) + '=');
        console.log('=' + ' '.repeat(l - 2) + '=');
        console.log('='.repeat(l));
        return P.delay(500);
    }

    mocha.before('coretest-before', function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        const start = Date.now();
        return P.resolve()
            .then(() => announce('mongo_client connect()'))
            .then(() => mongo_client.instance().connect('skip_init_db'))
            .then(() => announce('mongo_client dropDatabase()'))
            .then(() => mongo_client.instance().db.dropDatabase())
            .then(() => announce('mongo_client reconnect()'))
            .then(() => mongo_client.instance().reconnect())
            .then(() => announce('ensure_support_account()'))
            .then(() => account_server.ensure_support_account())
            .then(() => announce('start_http_server'))
            .then(() => server_rpc.rpc.start_http_server({
                port: 0,
                protocol: 'ws:',
                logging: true,
                default_handler: endpoint_request_handler,
            }))
            .then(http_server_arg => {
                // the http/ws port is used by the agents
                http_server = http_server_arg;
                const http_port = http_server.address().port;
                base_address = `ws://127.0.0.1:${http_port}`;
                http_address = `http://127.0.0.1:${http_port}`;

                // update the nodes_monitor n2n_rpc to find the base_address correctly for signals
                node_server.get_local_monitor().n2n_rpc.router.default = base_address;
                node_server.get_local_monitor().n2n_rpc.router.master = base_address;
            })
            .then(() => announce(`base_address ${base_address}`))
            .then(() => announce('create_system()'))
            .then(() => rpc_client.system.create_system({
                activation_code: '123',
                name: SYSTEM,
                email: EMAIL,
                password: PASSWORD,
            }))
            .then(res => {
                rpc_client.options.auth_token = res.token;
            })
            .then(() => init_internal_storage(SYSTEM))
            .then(() => announce('init_test_nodes()'))
            .delay(3000)
            .then(() => init_test_nodes(rpc_client, SYSTEM, 10))
            .then(() => announce(`coretest ready... (took ${((Date.now() - start) / 1000).toFixed(1)} sec)`));
    });


    mocha.after('coretest-after', function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this

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
        return P.resolve()
            .then(() => announce('clear_test_nodes()'))
            .then(() => clear_test_nodes())
            .delay(1000)
            .then(() => announce('rpc set_disconnected_state()'))
            .then(() => server_rpc.rpc.set_disconnected_state(true))
            .then(() => announce('mongo_client disconnect()'))
            .then(() => mongo_client.instance().disconnect())
            .then(() => announce('http_server close()'))
            .then(() => http_server && http_server.close())
            .then(() => announce('coretest done ...'))
            .then(() => setInterval(() => {
                console.log('process._getActiveRequests', process._getActiveRequests());
                console.log('process._getActiveHandles', process._getActiveHandles());
            }, 30000).unref());
    });

}

// create some test agents named 0, 1, 2, ..., count
function init_test_nodes(client, system, count) {
    return P.resolve()
        .then(() => node_server.start_monitor())
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
        .then(() => node_server.sync_monitor_to_store())
        .then(() => P.delay(2000))
        .then(() => node_server.sync_monitor_to_store());
}

// delete all test agents and nodes
function clear_test_nodes() {
    return P.resolve()
        .then(() => console.log('CLEANING AGENTS'))
        .then(() => core_agent_control.cleanup_agents())
        .then(() => console.log('REMOVE NODES'))
        .then(() => NodesStore.instance().test_code_delete_all_nodes())
        .then(() => console.log('STOP MONITOR'))
        .then(() => node_server.stop_monitor('force_close_n2n'));
}

function get_http_address() {
    return http_address;
}

// This was coded for tests that create multiple systems (not nessesary parallel, could be creation of system after deletion of system)
// Webserver's init happens only one time (upon init of process), it is crucial in order to ensure internal storage structures
// When we create systems without doing the init, we encounter a problem regarding failed internal storage structures
function init_internal_storage(system_name) {
    const system = _.find(system_store.data.systems, sys => sys.name === system_name);
    const internal_pool = system.pools_by_name[config.INTERNAL_STORAGE_POOL_NAME];
    const spillover_tier = system.tiers_by_name[config.SPILLOVER_TIER_NAME];
    if (!internal_pool || !spillover_tier) {
        console.warn('ASSUME THAT FIRST SYSTEM');
        return;
    }
    const changes = {
        update: {
            pools: [{
                _id: internal_pool._id,
                name: `${config.INTERNAL_STORAGE_POOL_NAME}-${system._id}`,
                system: system._id
            }],
            tiers: [{
                _id: spillover_tier._id,
                name: `${config.SPILLOVER_TIER_NAME}-${system._id}`,
                system: system._id
            }]
        }
    };
    return system_store.make_changes(changes);
}

exports.setup = setup;
exports.SYSTEM = SYSTEM;
exports.EMAIL = EMAIL;
exports.PASSWORD = PASSWORD;
exports.rpc_client = rpc_client;
exports.new_rpc_client = new_rpc_client;
exports.get_http_address = get_http_address;
