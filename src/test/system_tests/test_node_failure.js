/* Copyright (C) 2016 NooBaa */
"use strict";

const argv = require('minimist')(process.argv);
const dbg = require('../../util/debug_module')(__filename);
if (argv.log_file) {
    dbg.set_log_to_file(argv.log_file);
}
dbg.set_process_name('test_node_failure');

let _ = require('lodash');
let P = require('../../util/promise');
let api = require('../../api');
let ops = require('../utils/basic_server_ops');
var dotenv = require('../../util/dotenv');
const { v4: uuid } = require('uuid');
dotenv.load();


let suffix = uuid().split('-')[0];

const {
    mgmt_ip = 'localhost',
        mgmt_port = '8080',
        s3_ip = 'localhost',
} = argv;



let TEST_CTX = {
    num_of_agents: 10,
    bucket: 'test-bucket-' + suffix,
    pool: 'test-pool-' + suffix,
    nodes_name: 'test-node-' + suffix,
    init_delay: 60,
    max_init_retries: 5,
    file_size_mb: 2
};


let rpc = api.new_rpc_from_base_address(`ws://${mgmt_ip}:${mgmt_port}`, 'INTERNAL'); //'ws://' + argv.ip + ':8080');
let client = rpc.new_client();

module.exports = {
    run_test: run_test
};

/////// Aux Functions ////////

function authenticate() {
    let auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return P.fcall(function() {
        return client.create_auth_token(auth_params);
    });
}

async function create_agents() {
    console.log('creating agents');
    const names = _.times(TEST_CTX.num_of_agents, i => TEST_CTX.nodes_name + (i + 1));
    for (const name of names) {
        await client.hosted_agents.create_agent({
            name: name,
            access_keys: {
                access_key: '123',
                secret_key: 'abc'
            }
        });
    }
    return names;
}

async function remove_agents() {
    console.log('removing agents');
    const names = _.times(TEST_CTX.num_of_agents, i => TEST_CTX.nodes_name + (i + 1));
    for (const name of names) {
        await client.hosted_agents.remove_agent({
            name: 'noobaa-internal-agent-' + name,
        });
    }
    return names;
}


function _list_nodes(retries) {
    let query = {
        filter: TEST_CTX.nodes_name,
        skip_mongo_nodes: true
    };
    return client.node.list_nodes({
            query: query
        })
        .then(reply => {
            if (!reply) {
                throw new Error('list nodes failed');
            }
            if (reply.total_count < TEST_CTX.num_of_agents || reply.filter_counts.by_mode.INITIALIZING) {
                let msg = `list nodes returned ${reply.total_count} nodes and ${reply.filter_counts.by_mode.INITIALIZING} initializing. ` +
                    `expected (${TEST_CTX.num_of_agents}) nodes.`;
                let total_tries = retries || 1;
                if (total_tries > TEST_CTX.max_init_retries) {
                    console.error(msg + `aborting after ${TEST_CTX.max_init_retries} retries`);
                    throw new Error(msg + `aborting after ${TEST_CTX.max_init_retries} retries`);
                }
                console.warn(msg + `retry in ${TEST_CTX.init_delay} seconds`);
                return P.delay(TEST_CTX.init_delay * 1000)
                    .then(() => _list_nodes(total_tries + 1));
            }
            return reply;
        });
}

function create_test_pool() {
    return _list_nodes()
        .then(reply => {
            let nodes = reply.nodes.map(node => ({
                name: node.name
            }));
            TEST_CTX.nodes = nodes;
            return client.pool.create_nodes_pool({
                name: TEST_CTX.pool,
                nodes: nodes
            });
        });
}

function create_test_bucket() {
    return client.tier.create_tier({
            name: 'tier-' + TEST_CTX.bucket,
            attached_pools: [TEST_CTX.pool],
            data_placement: 'SPREAD'
        })
        .then(() => client.tiering_policy.create_policy({
            name: 'tiering-' + TEST_CTX.bucket,
            tiers: [{
                order: 0,
                tier: 'tier-' + TEST_CTX.bucket,
                spillover: false,
                disabled: false
            }]
        }))
        .then(() => client.bucket.create_bucket({
            name: TEST_CTX.bucket,
            tiering: 'tiering-' + TEST_CTX.bucket,
        }));
}

function setup() {
    return create_agents()
        .then(() => {
            console.log('created %s agents. waiting for %s seconds to init', TEST_CTX.num_of_agents, TEST_CTX.init_delay);
        })
        .then(() => P.delay(TEST_CTX.init_delay * 1000))
        .then(() => create_test_pool())
        .then(() => create_test_bucket());
}

function upload_file() {
    return ops.generate_random_file(TEST_CTX.file_size_mb)
        .then(file => {
            console.log(`uploading file ${file} to bucket ${TEST_CTX.bucket}`);
            TEST_CTX.key = file;
            return ops.upload_file(s3_ip, file, TEST_CTX.bucket, file);
        });
}

function read_mappings() {
    console.log(`read objects mapping for file ${TEST_CTX.key}`);
    return client.object.read_object_mapping_admin({
            bucket: TEST_CTX.bucket,
            key: TEST_CTX.key,
        })
        .then(reply => {
            TEST_CTX.chunks = reply.chunks.map((chunk, i) => ({
                part: i,
                blocks: chunk.frags[0].blocks.map(block => block.adminfo)
            }));
            TEST_CTX.chunks_by_nodes = {};
            _.each(TEST_CTX.chunks, part => {
                _.each(part.blocks, block => {
                    if (!TEST_CTX.chunks_by_nodes[block.node_name]) {
                        TEST_CTX.chunks_by_nodes[block.node_name] = [];
                    }
                    TEST_CTX.chunks_by_nodes[block.node_name].push(block);
                });
            });
        });
}

// test that each part has at least 3 online blocks.
function validate_mappings() {
    _.each(TEST_CTX.chunks, ({ blocks }) => {
        if (blocks.length < 3) {
            console.log('not enough replicas, wait and retry');
            throw new Error('part has less than 3 blocks');
        }
        let num_online = 0;
        _.each(blocks, block => {
            if (block.online) {
                num_online += 1;
            }
        });
        if (num_online < 3) {
            console.log('not enough online replicas, wait and retry');
            throw new Error('part has less than 3 online blocks');
        }
    });
}


function test_node_fail_replicate() {
    // kill first node in the nodes array, and then test it's blocks
    let node = _.keys(TEST_CTX.chunks_by_nodes)[0];
    return client.hosted_agents.remove_agent({
            name: node
        })
        .then(() => {
            console.log(`removed agent ${node}. waiting for 60 seconds for the change to take place`);
        })
        .then(() => P.delay(60000))
        .then(() => P.retry({
            attempts: 10,
            delay_ms: 5000,
            func: async () => {
                await read_mappings();
                validate_mappings();
            }
        }));
}

function run_test() {
    return P.resolve()
        .then(authenticate)
        .then(setup)
        .then(upload_file)
        .then(read_mappings)
        .then(test_node_fail_replicate)
        .then(remove_agents)
        .then(() => {
            console.log('test_node_failure PASSED');
        })
        .catch(err => {
            remove_agents();
            console.log('test_node_failure failed. err =', err);
            throw err;
        });
}


function main() {
    return run_test()
        .then(function() {
            process.exit(0);
        })
        .catch(function() {
            process.exit(1);
        });
}

if (require.main === module) {
    main();
}
