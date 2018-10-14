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

const api = require('../../api');
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
            .then(() => mongo_client.instance().db().dropDatabase())
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
            .then(() => rpc_client.pool.create_hosts_pool({
                name: config.NEW_SYSTEM_POOL_NAME,
            }))
            .then(() => attach_pool_to_bucket(SYSTEM, 'first.bucket', config.NEW_SYSTEM_POOL_NAME))
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
        .then(() => console.log('STOP MONITOR'))
        .then(() => node_server.stop_monitor('force_close_n2n'));
}

function get_http_address() {
    return http_address;
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

            mocha.before(function() {
                this.timeout(600000); // eslint-disable-line no-invalid-this
                return P.resolve()
                    .then(() => rpc_client.bucket.create_bucket({
                        name: bucket_name,
                        chunk_coder_config,
                        // using small chunks to make the tests lighter
                        chunk_split_config: {
                            avg_chunk: 100,
                            delta_chunk: 50,
                        },
                    }));
            });

            // deleting the objects to free memory because the test uses block_store_mem.js
            mocha.after(function() {
                this.timeout(600000); // eslint-disable-line no-invalid-this
                return P.resolve()
                    .then(() => rpc_client.object.list_objects_admin({ bucket: bucket_name }))
                    .then(res => rpc_client.object.delete_multiple_objects({
                        bucket: bucket_name,
                        objects: res.objects.map(o => ({ key: o.key })),
                    }));
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
exports.describe_mapper_test_case = describe_mapper_test_case;
