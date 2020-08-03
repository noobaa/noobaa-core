/* Copyright (C) 2016 NooBaa */
'use strict';

const wtf = require("wtfnode");

console.log('loading .env file');
require('../../util/dotenv').load();
require('../../util/panic').enable_heapdump('coretest');
require('../../util/fips');

const CORETEST = 'coretest';
process.env.JWT_SECRET = CORETEST;
process.env.CORETEST_MONGODB_URL = process.env.CORETEST_MONGODB_URL || `mongodb://localhost/${CORETEST}`;
process.env.MONGODB_URL = process.env.CORETEST_MONGODB_URL;

const config = require('../../../config.js');
const system_store = require('../../server/system_services/system_store').get_instance();
const MDStore = require('../../server/object_services/md_store').MDStore;

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

const argv = require('minimist')(process.argv);
const dbg = require('../../util/debug_module')(__filename);
const dbg_level =
    (process.env.SUPPRESS_LOGS && -5) ||
    (argv.verbose && 5) ||
    0;
dbg.set_level(dbg_level, 'core');

const endpoint = require('../../endpoint/endpoint');
const server_rpc = require('../../server/server_rpc');
const auth_server = require('../../server/common_services/auth_server');
const node_server = require('../../server/node_services/node_server');
const mongo_client = require('../../util/mongo_client');
const account_server = require('../../server/system_services/account_server');
const system_server = require('../../server/system_services/system_server');
const promise_utils = require('../../util/promise_utils');

// Set the pools server pool controller factory to create pools with
// backed by in process agents.
const pool_server = require('../../server/system_services/pool_server');
const pool_ctrls = require('../../server/system_services/pool_controllers');
pool_server.set_pool_controller_factory((system, pool) =>
    new pool_ctrls.InProcessAgentsPoolController(system.name, pool.name)
);

let base_address;
let http_address;
let http_server;
let https_address;
let https_server;
let _setup = false;
let _incomplete_rpc_coverage;
const api_coverage = new Set();
const rpc_client = server_rpc.rpc.new_client({
    auth_token: auth_server.make_auth_token({}),
    tracker: req => api_coverage.delete(req.srv),
});

const SYSTEM = CORETEST;
const EMAIL = `${CORETEST}@noobaa.com`;
const PASSWORD = CORETEST;
const POOL_LIST = [{
        name: 'pool-with-10-hosts',
        host_count: 10
    },
    {
        name: 'pool-with-1-host',
        host_count: 1
    }
];

let CREATED_POOLS = null;

function new_rpc_client() {
    return server_rpc.rpc.new_client(rpc_client.options);
}

function setup(options = {}) {
    const { incomplete_rpc_coverage, pools_to_create = [] } = options;
    if (_setup) return;
    _setup = true;

    if (incomplete_rpc_coverage) {
        assert(incomplete_rpc_coverage === 'show' || incomplete_rpc_coverage === 'fail',
            'coretest: incomplete_rpc_coverage expected value "show" or "fail"');
        _incomplete_rpc_coverage = incomplete_rpc_coverage;
    }

    server_rpc.get_base_address = () => 'fcall://fcall';
    server_rpc.register_system_services();
    server_rpc.register_node_services();
    server_rpc.register_bg_services();
    server_rpc.register_hosted_agents_services();
    server_rpc.register_object_services();
    server_rpc.register_func_services();
    server_rpc.register_common_services();
    server_rpc.rpc.set_request_logger(() => dbg.log1.apply(dbg, arguments));
    _.each(server_rpc.rpc.router, (val, key) => {
        server_rpc.rpc.router[key] = 'fcall://fcall';
    });
    _.each(server_rpc.rpc._services,
        (service, srv) => api_coverage.add(srv));

    const endpoint_request_handler = endpoint.create_endpoint_handler(server_rpc.rpc, rpc_client, {
        s3: true,
        blob: true,
        lambda: true,
        n2n_agent: false, // we use n2n_proxy
    });

    async function announce(msg) {
        if (process.env.SUPPRESS_LOGS) return;
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
        system_store.clean_system_store();
        await server_rpc.client.redirector.publish_to_cluster({
            method_api: 'server_inter_process_api',
            method_name: 'load_system_store',
            target: '',
            request_params: {}

        });
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
        const https_port = https_server.address().port;

        base_address = `wss://127.0.0.1:${https_port}`;
        http_address = `http://127.0.0.1:${http_port}`;
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
        await overwrite_system_address(SYSTEM);
        if (pools_to_create.length > 0) {
            await announce('setup_pools()');
            await setup_pools(pools_to_create);
        }
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
        await announce('clear_test_pools()');
        await clear_test_pools();
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

        let tries_left = 3;
        setInterval(function check_dangling_handles() {
            tries_left -= 1;
            console.info(`Waiting for dangling handles to release, re-sample in 30s (tries left: ${tries_left})`);
            wtf.dump();

            if (tries_left === 0) {
                console.error('Tests cannot complete successfully, running tests resulted in dangling handles');

                // Force the test suite to fail (ignoring the exist handle that mocha sets up in order to return a fail
                // exit code)
                process.removeAllListeners('exit');
                process.exit(1);
            }
        }, 30000).unref();
    });
}

async function setup_pools(pools_to_create) {
    console.log('setup_pools()');
    if (CREATED_POOLS) {
        console.error('Setup pools was already called');
        throw new Error('INVALID_SETUP_POOLS_CALL');
    }

    await init_test_pools(rpc_client, SYSTEM, pools_to_create);
    await attach_pool_to_bucket(SYSTEM, 'first.bucket', CREATED_POOLS[0].name);
    await set_pool_as_default_resource(SYSTEM, CREATED_POOLS[0].name);
}

function log(...args) {
    if (process.env.SUPPRESS_LOGS) return;
    console.log(...args);
}

async function overwrite_system_address(system_name) {
    // Waiting for system server to fully initialize to ensure
    // that this overwrite will not be undone when the system server
    // discover system addresses during it's init phase.
    console.log('Waiting for system server to initialize');
    await promise_utils.wait_until(
        () => system_server.is_initialized(),
        2 * 60 * 1000,
        1000
    );

    console.log('Overriding system, address with:', base_address);
    const system = system_store.data.systems
        .find(sys => sys.name === system_name);

    // Add the base address as external address to allow
    // the pool server to pass it to the created agents.
    const { hostname, port, protocol } = new URL(base_address);
    const system_address = [{
        service: 'noobaa-mgmt',
        port: Number(port),
        api: 'mgmt',
        secure: protocol === 'wss:',
        kind: 'INTERNAL',
        weight: 0,
        hostname
    }];

    await system_store.make_changes({
        update: {
            systems: [{
                _id: system._id,
                $set: { system_address }
            }]
        }
    });
}

async function init_test_pools(client, system_name, pools_to_create) {
    console.log('Creating pools:', pools_to_create);

    await node_server.start_monitor();

    // Create pools.
    await Promise.all(pools_to_create.map(pool_info =>
        rpc_client.pool.create_hosts_pool({
            name: pool_info.name,
            host_count: pool_info.host_count,
            is_managed: true,
        })
    ));

    // Wait until all pools have hosts in optimal state.
    await promise_utils.wait_until(async () => {
        const { hosts } = await rpc_client.host.list_hosts({
            query: {
                pools: pools_to_create.map(pool_info => pool_info.name),
                mode: ['OPTIMAL'],
            }
        });

        const optimal_hosts_by_Pool = _.countBy(hosts, host => host.pool);
        return pools_to_create.every(pool =>
            pool.host_count === (optimal_hosts_by_Pool[pool.name] || 0)
        );
    }, 5 * 60 * 1000, 2500);

    CREATED_POOLS = pools_to_create;

    await node_server.sync_monitor_to_store();
    await P.delay(2000);
    await node_server.sync_monitor_to_store();
}

// delete all test pools (including hosts and agents)
async function clear_test_pools() {
    console.log('CLEANING ALL CHUNKS');
    // as we don't run object_reclaimer bg, some chunks can be left in system and rebuilds will never let the tests finish
    await MDStore.instance().delete_all_chunks_in_system();
    console.log('CLEANING POOLS');
    // Remove all connections between buckets and pools.
    await Promise.all(
        system_store.data.tiers.map(tier =>
            rpc_client.tier.update_tier({
                name: tier.name,
                data_placement: 'MIRROR', // Must be sent in order to apply attached_pools
                attached_pools: []
            })
        )
    );

    // Prevent accounts from preventing pool deletions (by using a pool as default resource)
    // by disabling s3 access for all accounts.
    const { accounts } = await rpc_client.account.list_accounts({});
    await Promise.all(accounts.map(account =>
        rpc_client.account.update_account_s3_access({
            email: account.email,
            s3_access: false
        })
    ));

    // Delete all pools (will stop all agents managed by the pool)
    if (CREATED_POOLS) {
        await promise_utils.wait_until(async () => {
            try {
                await Promise.all(CREATED_POOLS.map(pool =>
                    rpc_client.pool.delete_pool({ name: pool.name })
                ));
            } catch (err) {
                if (err.rpc_code !== 'BEING_DELETED') throw err;
            }
            const { pools } = await rpc_client.system.read_system({});
            const existing_pools = new Set(pools.map(pool => pool.name));
            console.log('Waiting until all pools are deleted (including hosts)', existing_pools);
            return CREATED_POOLS.every(pool => !existing_pools.has(pool.name));
        }, 5 * 60 * 1000, 2500);
    }

    console.log('STOP MONITOR');
    await node_server.stop_monitor('force_close_n2n');
}

function get_http_address() {
    return http_address;
}

function get_https_address() {
    return https_address;
}

// This was coded for tests that create multiple systems (not necessary parallel, could be creation of system after deletion of system)
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

function set_pool_as_default_resource(system, pool_name) {
    const pool_id = system_store.data.pools
        .find(pool => pool.name === pool_name)
        ._id;

    return system_store.make_changes({
        update: {
            accounts: _.map(system_store.data.accounts, account => ({
                _id: account._id,
                default_pool: pool_id,
            }))
        }
    });
}

function describe_mapper_test_case({ name, bucket_name_prefix }, func) {
    const PLACEMENTS = ['SPREAD', 'MIRROR'];

    const NUM_POOLS_BASIC = [1, 2, 3];
    const NUM_POOLS_FULL = [1, 2, 3, 13];

    const REPLICAS_BASIC = [1, 3];
    const REPLICAS_FULL = [1, 2, 3, 6];

    const EC_BASIC = [
        '1+0',
        //'4+2',
        //'8+2',
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

function get_dbg_level() {
    return dbg_level;
}

exports.setup = setup;
exports.setup_pools = setup_pools;
exports.no_setup = _.noop;
exports.log = log;
exports.SYSTEM = SYSTEM;
exports.EMAIL = EMAIL;
exports.POOL_LIST = POOL_LIST;
exports.PASSWORD = PASSWORD;
exports.rpc_client = rpc_client;
exports.new_rpc_client = new_rpc_client;
exports.get_http_address = get_http_address;
exports.get_https_address = get_https_address;
exports.describe_mapper_test_case = describe_mapper_test_case;
exports.get_dbg_level = get_dbg_level;
