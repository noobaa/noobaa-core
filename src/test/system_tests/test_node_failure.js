/* Copyright (C) 2016 NooBaa */
"use strict";

let _ = require('lodash');
let P = require('../../util/promise');
let api = require('../../api');
let ops = require('./basic_server_ops');
let promise_utils = require('../../util/promise_utils');
var dotenv = require('../../util/dotenv');
const uuid = require('uuid/v4');
dotenv.load();


let suffix = uuid().split('-')[0];

let TEST_CTX = {
    num_of_agents: 10,
    bucket: 'test-bucket-' + suffix,
    pool: 'test-pool-' + suffix,
    nodes_name: 'test-node-' + suffix,
    init_delay: 60,
    max_init_retries: 5,
    file_size_mb: 2
};


let rpc = api.new_rpc(); //'ws://' + argv.ip + ':8080');
let client = rpc.new_client({});

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


// function create_system() {
//     return P.resolve(client.system.create_system({
//         activation_code: 'bla',
//         email: 'demo@noobaa.com',
//         password: 'DeMo1',
//         name: 'demo',
//     }));
// }

function create_agents() {
    console.log('creating agents');
    const names = _.times(TEST_CTX.num_of_agents, i => TEST_CTX.nodes_name + (i + 1));
    return P.each(names, name => client.hosted_agents.create_agent({
            name: name,
            access_keys: {
                access_key: '123',
                secret_key: 'abc'
            }
        }))
        .then(() => names);
}

function remove_agents() {
    console.log('removing agents');
    const names = _.times(TEST_CTX.num_of_agents, i => TEST_CTX.nodes_name + (i + 1));
    return P.each(names, name => client.hosted_agents.remove_agent({
            name: 'noobaa-internal-agent-' + name,
        }))
        .then(() => names);
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
            if (reply.total_count < TEST_CTX.num_of_agents || reply.filter_counts.by_mode.INITALIZING) {
                let msg = `list nodes returned ${reply.total_count} nodes and ${reply.filter_counts.by_mode.INITALIZING} initializing. ` +
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
        .then(() =>
            client.tiering_policy.create_policy({
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
        .delay(TEST_CTX.init_delay * 1000)
        .then(() => create_test_pool())
        .then(() => create_test_bucket());
}

function upload_file() {
    return ops.generate_random_file(TEST_CTX.file_size_mb)
        .then(file => {
            console.log(`uploading file ${file} to bucket ${TEST_CTX.bucket}`);
            TEST_CTX.key = file;
            return ops.upload_file('127.0.0.1', file, TEST_CTX.bucket, file);
        });
}

function read_mappings() {
    console.log(`read objects mapping for file ${TEST_CTX.key}`);
    return client.object.read_object_mappings({
            bucket: TEST_CTX.bucket,
            key: TEST_CTX.key,
            adminfo: true
        })
        .then(reply => {
            TEST_CTX.parts = reply.parts.map((part, i) => ({
                part: i,
                blocks: part.chunk.frags[0].blocks.map(block => block.adminfo)
            }));
            TEST_CTX.parts_by_nodes = {};
            _.each(TEST_CTX.parts, part => {
                _.each(part.blocks, block => {
                    if (!TEST_CTX.parts_by_nodes[block.node_name]) {
                        TEST_CTX.parts_by_nodes[block.node_name] = [];
                    }
                    TEST_CTX.parts_by_nodes[block.node_name].push(block);
                });
            });
        });
}

// test that each part has at least 3 online blocks.
function validate_mappings() {
    _.each(TEST_CTX.parts, part => {
        if (part.blocks.length < 3) {
            console.log('not enough replicas, wait and retry');
            throw new Error('part has less than 3 blocks');
        }
        let num_online = 0;
        _.each(part.blocks, block => {
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
    let node = _.keys(TEST_CTX.parts_by_nodes)[0];
    return client.hosted_agents.remove_agent({
            name: node
        })
        .then(() => {
            console.log(`removed agent ${node}. waiting for 60 seconds for the change to take place`);
        })
        .delay(60000)
        .then(() => promise_utils.retry(10, 5000, () => {
            read_mappings();
            validate_mappings();
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
            process.exit(0);
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
