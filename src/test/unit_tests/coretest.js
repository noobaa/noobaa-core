/* Copyright (C) 2016 NooBaa */
'use strict';

const panic = require('../../util/panic');
panic.enable_heapdump('coretest');

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

const dbg = require('../../util/debug_module')(__filename);
const argv = require('minimist')(process.argv);
const endpoint = require('../../endpoint/endpoint');
const server_rpc = require('../../server/server_rpc');
const node_server = require('../../server/node_services/node_server');
const mongo_client = require('../../util/mongo_client');
const account_server = require('../../server/system_services/account_server');
const core_agent_control = require('./core_agent_control');

if (argv.verbose) {
    dbg.set_level(5, 'core');
}

let base_address;
let http_address;
let http_server;
let https_address;
let https_server;
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

    server_rpc.get_base_address = () => 'fcall://fcall';

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

    async function announce(msg) {
        const l = Math.max(80, msg.length + 4);
        console.log('='.repeat(l));
        console.log('=' + ' '.repeat(l - 2) + '=');
        console.log('= ' + msg + ' '.repeat(l - msg.length - 3) + '=');
        console.log('=' + ' '.repeat(l - 2) + '=');
        console.log('='.repeat(l));
        await P.delay(500);
    }

    mocha.before('coretest-before', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        const start = Date.now();

        await announce('mongo_client connect()');
        await mongo_client.instance().connect('skip_init_db');
        await announce('mongo_client dropDatabase()');
        await mongo_client.instance().db().dropDatabase();
        await announce('mongo_client reconnect()');
        await mongo_client.instance().reconnect();
        await announce('ensure_support_account()');
        await account_server.ensure_support_account();

        await announce('start_http_server');
        http_server = await server_rpc.rpc.start_http_server({
            port: 0,
            protocol: 'ws:',
            logging: true,
            default_handler: endpoint_request_handler,
        });

        await announce('start_https_server');
        https_server = await server_rpc.rpc.start_http_server({
            port: 0,
            protocol: 'wss:',
            logging: true,
            default_handler: endpoint_request_handler,
        });

        // the http/ws port is used by the agents
        const http_port = http_server.address().port;
        base_address = `ws://127.0.0.1:${http_port}`;
        http_address = `http://127.0.0.1:${http_port}`;

        const https_port = https_server.address().port;
        https_address = `https://127.0.0.1:${https_port}`;

        // update the nodes_monitor n2n_rpc to find the base_address correctly for signals
        await node_server.start_monitor();
        node_server.get_local_monitor().n2n_rpc.router.default = base_address;
        node_server.get_local_monitor().n2n_rpc.router.master = base_address;
        await announce(`base_address ${base_address}`);

        await announce('create_system()');
        const { token } = await rpc_client.system.create_system({
            name: SYSTEM,
            email: EMAIL,
            password: PASSWORD,
        });
        rpc_client.options.auth_token = token;
        await rpc_client.pool.create_hosts_pool({
            name: config.NEW_SYSTEM_POOL_NAME,
        });
        await attach_pool_to_bucket(SYSTEM, 'first.bucket', config.NEW_SYSTEM_POOL_NAME);
        await announce('init_test_nodes()');
        await P.delay(3000);
        await init_test_nodes(rpc_client, SYSTEM, 10);
        await announce(`coretest ready... (took ${((Date.now() - start) / 1000).toFixed(1)} sec)`);
    });


    mocha.after('coretest-after', async function() {
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
        await announce('clear_test_nodes()');
        await clear_test_nodes();
        await P.delay(1000);
        await announce('rpc set_disconnected_state()');
        server_rpc.rpc.set_disconnected_state(true);
        await announce('mongo_client disconnect()');
        await mongo_client.instance().disconnect();
        await announce('http_server close()');
        if (http_server) http_server.close();
        await announce('https_server close()');
        if (https_server) https_server.close();
        await announce('coretest done ...');
        setInterval(() => {
            const reqs = process._getActiveRequests();
            console.log(`### Active Requests: found ${reqs.length} items`);
            for (const r of reqs) console.log('### Active Request:', r);
            const handles = process._getActiveHandles();
            console.log(`### Active Handles: found ${handles.length} items`);
            for (const h of handles) console.log('### Active Handle:', h);
        }, 30000).unref();
    });

}

// create some test agents named 0, 1, 2, ..., count
async function init_test_nodes(client, system, count) {
    await node_server.start_monitor();
    const { token } = await client.auth.create_auth({
        role: 'create_node',
        system: system
    });
    const create_node_token = token;
    core_agent_control.use_local_agents(base_address, create_node_token);
    core_agent_control.create_agent(count);
    await core_agent_control.start_all_agents();
    console.log(`created ${count} agents`);
    await node_server.sync_monitor_to_store();
    await P.delay(2000);
    await node_server.sync_monitor_to_store();
}

// delete all test agents and nodes
async function clear_test_nodes() {
    console.log('CLEANING AGENTS');
    await core_agent_control.cleanup_agents();
    console.log('STOP MONITOR');
    await node_server.stop_monitor('force_close_n2n');
}

function get_http_address() {
    return http_address;
}

function get_https_address() {
    return https_address;
}

// This was coded for tests that create multiple systems (not nessesary parallel, could be creation of system after deletion of system)
// Webserver's init happens only one time (upon init of process), it is crucial in order to ensure internal storage structures
// When we create systems without doing the init, we encounter a problem regarding failed internal storage structures
// function init_internal_storage(system_name) {
//     const system = _.find(system_store.data.systems, sys => sys.name === system_name);
//     const internal_pool = system.pools_by_name[config.INTERNAL_STORAGE_POOL_NAME];
//     const spillover_tier = system.tiers_by_name[config.SPILLOVER_TIER_NAME];
//     if (!internal_pool || !spillover_tier) {
//         console.warn('ASSUME THAT FIRST SYSTEM');
//         return;
//     }
//     const changes = {
//         update: {
//             pools: [{
//                 _id: internal_pool._id,
//                 name: `${config.INTERNAL_STORAGE_POOL_NAME}-${system._id}`,
//                 system: system._id
//             }],
//             tiers: [{
//                 _id: spillover_tier._id,
//                 name: `${config.SPILLOVER_TIER_NAME}-${system._id}`,
//                 system: system._id
//             }]
//         }
//     };
//     return system_store.make_changes(changes);
// }

function attach_pool_to_bucket(system_name, bucket_name, pool_name) {
    const system = _.find(system_store.data.systems, sys => sys.name === system_name);
    const pool = system.pools_by_name[pool_name];
    const bucket = system.buckets_by_name[bucket_name];
    const tiering = bucket.tiering;
    const tier0 = tiering.tiers[0].tier;
    const change = {
        update: {
            tiers: [{
                _id: tier0._id,
                $set: {
                    "mirrors.0.spread_pools.0": pool._id
                }
            }]
        }
    };
    return system_store.make_changes(change);
}

function describe_mapper_test_case({ name, bucket_name_prefix }, func) {
    const PLACEMENTS = ['SPREAD', 'MIRROR'];

    const NUM_POOLS_BASIC = [1, 2, 3];
    const NUM_POOLS_FULL = [1, 2, 3, 13];

    const REPLICAS_BASIC = [1, 3];
    const REPLICAS_FULL = [1, 2, 3, 6];

    const EC_BASIC = [
        '1+0',
        '4+2',
        '8+2',
    ].map(parse_ec);

    const EC_FULL = [
        '1+0', '1+1', '1+2',
        '2+0', '2+1', '2+2',
        '4+0', '4+1', '4+2', '4+3', '4+4',
        '6+0', '6+1', '6+2', '6+3', '6+4',
        '8+0', '8+1', '8+2', '8+3', '8+4',
    ].map(parse_ec);

    function parse_ec(str) {
        const [d, p] = str.split('+');
        return { data_frags: Number(d), parity_frags: Number(p) };
    }

    const variations = [];

    // run with --full to include all variations
    if (argv.full) {
        for (const data_placement of PLACEMENTS) {
            for (const num_pools of NUM_POOLS_FULL) {
                // replicas(full) * ec(basic)
                for (const replicas of REPLICAS_FULL) {
                    for (const { data_frags, parity_frags } of EC_BASIC) {
                        variations.push({
                            data_placement,
                            num_pools,
                            replicas,
                            data_frags,
                            parity_frags,
                        });
                    }
                }
                // replicas(basic) * ec(full)
                for (const replicas of REPLICAS_BASIC) {
                    for (const { data_frags, parity_frags } of EC_FULL) {
                        variations.push({
                            data_placement,
                            num_pools,
                            replicas,
                            data_frags,
                            parity_frags,
                        });
                    }
                }
            }
        }
    } else {
        for (const data_placement of PLACEMENTS) {
            for (const num_pools of NUM_POOLS_BASIC) {
                // replicas(basic) * ec(basic)
                for (const replicas of REPLICAS_BASIC) {
                    for (const { data_frags, parity_frags } of EC_BASIC) {
                        variations.push({
                            data_placement,
                            num_pools,
                            replicas,
                            data_frags,
                            parity_frags,
                        });
                    }
                }
            }
        }
    }

    let bucket_counter = 1;

    for (const {
            data_placement,
            num_pools,
            replicas,
            data_frags,
            parity_frags,
        } of variations) {
        const total_frags = data_frags + parity_frags;
        const total_replicas = data_placement === 'MIRROR' ? replicas * num_pools : replicas;
        const total_blocks = total_replicas * total_frags;
        const chunk_coder_config = { replicas, data_frags, parity_frags };
        const test_name = `${data_placement} num_pools=${num_pools} replicas=${replicas} data_frags=${data_frags} parity_frags=${parity_frags}`;
        const bucket_name = bucket_name_prefix ? `${bucket_name_prefix}-${bucket_counter}` : '';
        bucket_counter += 1;
        const test_case = {
            test_name,
            bucket_name,
            data_placement,
            num_pools,
            replicas,
            data_frags,
            parity_frags,
            total_frags,
            total_blocks,
            total_replicas,
            chunk_coder_config,
        };
        _describe_mapper_test_case(test_case, func);
    }
}

function _describe_mapper_test_case(test_case, func) {
    const { test_name, bucket_name, chunk_coder_config } = test_case;

    mocha.describe(test_name, function() {

        if (bucket_name) {

            mocha.before(async function() {
                this.timeout(600000); // eslint-disable-line no-invalid-this
                await rpc_client.bucket.create_bucket({
                    name: bucket_name,
                    chunk_coder_config,
                    // using small chunks to make the tests lighter
                    chunk_split_config: {
                        avg_chunk: 100,
                        delta_chunk: 50,
                    },
                });
            });

            // deleting the objects to free memory because the test uses block_store_mem.js
            mocha.after(async function() {
                this.timeout(600000); // eslint-disable-line no-invalid-this
                const res = await rpc_client.object.list_objects_admin({ bucket: bucket_name });
                await rpc_client.object.delete_multiple_objects({
                    bucket: bucket_name,
                    objects: res.objects.map(o => ({ key: o.key })),
                });
            });
        }

        func(test_case);

    });
}

exports.setup = setup;
exports.no_setup = _.noop;
exports.SYSTEM = SYSTEM;
exports.EMAIL = EMAIL;
exports.PASSWORD = PASSWORD;
exports.rpc_client = rpc_client;
exports.new_rpc_client = new_rpc_client;
exports.get_http_address = get_http_address;
exports.get_https_address = get_https_address;
exports.describe_mapper_test_case = describe_mapper_test_case;
