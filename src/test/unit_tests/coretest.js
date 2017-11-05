/* Copyright (C) 2016 NooBaa */
'use strict';

console.log('loading .env file');
require('../../util/dotenv').load();

process.env.JWT_SECRET = 'coretest';
process.env.MONGODB_URL =
    process.env.CORETEST_MONGODB_URL =
    process.env.CORETEST_MONGODB_URL || 'mongodb://localhost/coretest';

const config = require('../../../config.js');
const system_store = require('../../server/system_services/system_store').get_instance();

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
const mongodb = require('mongodb');

const api = require('../../api');
const endpoint = require('../../endpoint/endpoint');
const server_rpc = require('../../server/server_rpc');
const node_server = require('../../server/node_services/node_server');
const mongo_client = require('../../util/mongo_client');
const node_allocator = require('../../server/node_services/node_allocator');
const account_server = require('../../server/system_services/account_server');
const core_agent_control = require('./core_agent_control');
const { NodesStore } = require('../../server/node_services/nodes_store');
const { BlockStoreMem } = require('../../agent/block_store_services/block_store_mem');
const { RPC_BUFFERS } = require('../../rpc');

let base_address;
let http_address;
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

    const endpoint_request_handler = endpoint.create_endpoint_handler(server_rpc.rpc, {
        s3: true,
        blob: true,
        lambda: true,
        n2n_agent: false, // we use n2n_proxy
    });

    mocha.before('coretest-before', function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(10000);
        return P.resolve()
            .then(() => console.log('running mongo_client.instance().connect()'))
            .then(() => mongo_client.instance().connect('skip_init_db'))
            .then(() => console.log('running mongo_client.instance().db.dropDatabase()'))
            .then(() => mongo_client.instance().db.dropDatabase())
            .then(() => console.log('running mongo_client.instance().reconnect()'))
            .then(() => mongo_client.instance().reconnect())
            .then(() => account_server.ensure_support_account())
            .then(() => console.log('running server_rpc.rpc.start_http_server'))
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
                console.log('CORETEST HTTP SERVER', http_port);
                base_address = `ws://127.0.0.1:${http_port}`;
                http_address = `http://127.0.0.1:${http_port}`;

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
        return P.resolve()
            .then(() => clear_test_nodes())
            .delay(1000)
            .then(() => server_rpc.rpc.set_disconnected_state(true))
            .then(() => mongo_client.instance().disconnect())
            .then(() => http_server && http_server.close())
            .then(() => setInterval(() => {
                console.log('process._getActiveRequests', process._getActiveRequests());
                console.log('process._getActiveHandles', process._getActiveHandles());
            }, 30000).unref());
    });

}

function new_test_client() {
    const client = server_rpc.rpc.new_client(client_options);
    return client;
}

function init_mock_nodes(client, system, count) {

    const mock_monitor = {
        _nodes: _.times(count, i => {
            const name = `node${i}`;
            const _id = new mongodb.ObjectId();
            const peer_id = new mongodb.ObjectId();
            const rpc_address = `n2n://${peer_id}`;
            // const rpc = api.new_rpc(base_address);
            // const rpc_client = rpc.new_client();
            // const n2n_agent = rpc.register_n2n_agent(rpc_client.node.n2n_signal);
            // n2n_agent.set_rpc_address(rpc_address);
            const block_store = new BlockStoreMem({
                node_name: name,
                rpc_client: client,
                // storage_limit: undefined,
                // proxy: undefined,
            });
            // rpc.register_service(rpc.schema.block_store_api, block_store, {});
            const node = {
                _id,
                peer_id,
                rpc_address,
                name,
                // rpc,
                // n2n_agent,
                block_store,
            };
            return node;
        }),
        _get_node_info(node) {
            const pool = system_store.data.systems_by_name[system].pools_by_name[config.NEW_SYSTEM_POOL_NAME];
            return {
                _id: node._id.toString(),
                peer_id: node.peer_id.toString(),
                name: node.name,
                pool: pool.name,
                rpc_address: node.rpc_address,
                has_issues: false,
                online: true,
                readable: true,
                writable: true,
                trusted: true,
                ip: '0.0.0.0',
                host_seq: '',
                os_info: { hostname: node.name },
                storage: { free: 1024 * 1024 * 1024 * 1024 },
            };
        },
        start() {
            // nop
        },
        stop() {
            // nop
        },
        list_nodes(params) {
            return {
                nodes: _.map(this._nodes, node => this._get_node_info(node))
            };
        },
        allocate_nodes(params) {
            return {
                nodes: _.map(this._nodes, node => this._get_node_info(node))
            };
        },
        // we use rpc n2n_proxy to send messages to the nodes in the test
        // so we avoid the n2n_agent and ICE altogether.
        n2n_proxy(params) {
            const node = _.find(this._nodes, n => n.rpc_address === params.target);
            if (params.request_params) {
                params.request_params[RPC_BUFFERS] = params[RPC_BUFFERS];
            }
            return node.block_store[params.method_name]({
                    // bit hacky rpc request object
                    params: params.request_params,
                    rpc_params: params.request_params,
                })
                .then(reply => ({
                    proxy_reply: reply,
                    [RPC_BUFFERS]: reply && reply[RPC_BUFFERS],
                }));
        }
    };

    return P.resolve()
        .then(() => clear_mock_nodes())
        .then(() => node_server.set_external_monitor(mock_monitor))
        .then(() => node_server.start_monitor())
        .then(() => node_allocator.reset_alloc_groups());
}

// delete all test nodes directly from the db
function clear_mock_nodes() {
    return P.resolve()
        .then(() => console.log('STOP MONITOR'))
        .then(() => node_server.stop_monitor('force_close_n2n'))
        .then(() => console.log('RESET ORIGINAL MONITOR'))
        .then(() => node_server.reset_original_monitor());
}

// create some test agents named 0, 1, 2, ..., count
function init_test_nodes(client, system, count) {
    return clear_test_nodes()
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
        .then(() => clear_mock_nodes());
}

function get_http_address() {
    return http_address;
}

// This was coded for tests that create multiple systems (not nessesary parallel, could be creation of system after deletion of system)
// Webserver's init happens only one time (upon init of process), it is crucial in order to ensure internal storage structures
// When we create systems without doing the init, we encounter a problem regarding failed internal storage structures
function create_system(client, params) {
    return P.resolve()
        .then(() => client.system.create_system(params))
        .then(token => {
            const system = _.find(system_store.data.systems, system_rec => String(system_rec.name) === String(params.name));
            const internal_pool = _.find(system.pools_by_name, pools_rec => pools_rec.name.indexOf(config.INTERNAL_STORAGE_POOL_NAME) > -1);
            const internal_tier = _.find(system.tiers_by_name, tier_rec => tier_rec.name.indexOf(config.SPILLOVER_TIER_NAME) > -1);
            if (!internal_pool || !internal_tier) {
                console.warn('ASSUME THAT FIRST SYSTEM');
                return P.resolve(token);
            }
            const changes = {
                update: {
                    pools: [{
                        _id: internal_pool._id,
                        name: `${config.INTERNAL_STORAGE_POOL_NAME}-${system._id}`,
                        system: system._id
                    }],
                    tiers: [{
                        _id: internal_tier._id,
                        name: `${config.SPILLOVER_TIER_NAME}-${system._id}`,
                        system: system._id
                    }]
                }
            };
            return system_store.make_changes(changes)
                .return(token);
        });
}

exports.setup = setup;
exports.client = new_test_client();
exports.new_test_client = new_test_client;
exports.get_http_address = get_http_address;
exports.create_system = create_system;
exports.init_mock_nodes = init_mock_nodes;
exports.init_test_nodes = init_test_nodes;
exports.clear_mock_nodes = clear_mock_nodes;
exports.clear_test_nodes = clear_test_nodes;
