"use strict";

let _ = require('lodash');
let P = require('../../util/promise');
let api = require('../../api');
let ops = require('./basic_server_ops');
let promise_utils = require('../../util/promise_utils');
var dotenv = require('dotenv');
dotenv.load();


let TEST_CTX = {
    ip: '127.0.0.1',
    bucket: 'files',
    object_key: '',
    timeout: 60
};

let rpc = api.new_rpc(); //'ws://' + argv.ip + ':8080');
let client = rpc.new_client({
    address: 'ws://' + TEST_CTX.ip + ':' + process.env.PORT
});

module.exports = {
    run_test: run_test
};

/////// Aux Functions ////////

function authenticate() {
    let auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo',
        system: 'demo'
    };
    return P.fcall(function() {
        client.create_auth_token(auth_params);
    });
}

function upload_random_file(size_mb) {
    return ops.generate_random_file(size_mb)
        .then(function(fname) {
            TEST_CTX.object_key = fname;
            return ops.upload_file(TEST_CTX.ip, fname, TEST_CTX.bucket, fname);
        });

}

///// Test Functions ///////

function test_uploaded_object_has_expected_num_blocks(expected_num_blocks) {
    let abort_timeout_sec = TEST_CTX.timeout;

    let first_iteration = true;
    let num_blocks = 0;
    let start_ts;
    let obj_mapping;
    // get the list of nodes in default_pool:
    return client.node.list_nodes({
            query: {
                pools: ['default_pool']
            }
        })
        .then(function(nodes_list) {
            // keep read_object_mappings until we see 3 blocks in the default_pool
            return promise_utils.pwhile(
                function() {
                    return num_blocks < expected_num_blocks;
                },
                function() {
                    return client.object.read_object_mappings({
                            bucket: TEST_CTX.bucket,
                            key: TEST_CTX.object_key
                        })
                        .then(function(obj_mapping_arg) {
                            obj_mapping = obj_mapping_arg;
                            let chunk_info = obj_mapping_arg.parts[0].chunk;
                            let blk_info = chunk_info.frags[0].blocks;
                            num_blocks = 0;
                            // go over all nodes and check that the block is in the pool:
                            for (let n = 0; n < nodes_list.nodes.length; n++) {
                                for (let blk = 0; blk < blk_info.length; blk++) {
                                    // console.log('checking block node = ', blk_info[blk].block_md.node, 'vs node.id = ', nodes_list.nodes[n].id);
                                    if (nodes_list.nodes[n].id === blk_info[blk].block_md.node) {
                                        num_blocks++;
                                    }
                                }
                            }
                            if (num_blocks < expected_num_blocks) {
                                if (first_iteration) {
                                    start_ts = Date.now();
                                    first_iteration = false;
                                    console.warn('number of blocks for uploaded object is ' + num_blocks + '. expecting ' + expected_num_blocks +
                                        ' blocks. retrying for ' + abort_timeout_sec + ' seconds...');
                                }

                                let diff = Date.now() - start_ts;
                                if (diff > abort_timeout_sec * 1000) {
                                    throw new Error('aborted test_object_blocks_number after ' + abort_timeout_sec + ' seconds');
                                }
                                return P.delay(500);

                            }
                            if (first_iteration) {
                                console.log('success: object has ' + expected_num_blocks + ' blocks as expected');
                                // console.log(blk_info);
                            } else {
                                let diff = (Date.now() - start_ts) / 1000;
                                console.warn('object has ' + expected_num_blocks + ' blocks after ' + diff + ' seconds');
                                // console.log(blk_info);
                            }
                        });
                }
            );
        })
        .then(function() {
            return obj_mapping;
        });
}

function move_one_block_to_different_pool(object_mapping) {
    // assuming here we have at least 6 nodes in the pool.
    // going to create a new pool with 1 node that holds a block and 2 other that doesn't

    let node_id = object_mapping.parts[0].chunk.frags[0].blocks[0].block_md.node;
    let blocks = object_mapping.parts[0].chunk.frags[0].blocks;
    return client.node.list_nodes({
            query: {
                online: true
            }
        })
        .then(function(node_list) {
            // build a nodes list with 1 node that holds blocks[0] and 2 nodes that holds none
            let new_pool_nodes = [];
            _.each(node_list.nodes, function(node) {
                if (new_pool_nodes.length === 3) {
                    return;
                }
                if ((node.id === node_id) ||
                    (node.id !== blocks[1].block_md.node && node.id !== blocks[2].block_md.node)) {
                    // console.log('adding node to pool: ' + node.name);
                    new_pool_nodes.push({
                        name: node.name
                    });
                }
            });
            var create_pool_params = {
                name: 'test',
                nodes: new_pool_nodes
            };
            // console.log('calling create_pool with these parameters: ', create_pool_params);
            console.log('moving 3 nodes to \'test\' pool: ', new_pool_nodes);
            return client.pool.create_nodes_pool(create_pool_params);
        });
}


function main() {
    return run_test()
        .then(function() {
            process.exit(0);
        })
        .catch(function(err) {
            process.exit(1);
        });
}

function run_test() {
    return authenticate()
        .then(() => upload_random_file(1))
        .then(() => test_uploaded_object_has_expected_num_blocks(3))
        .then(obj_mapping => move_one_block_to_different_pool(obj_mapping))
        .then(() => test_uploaded_object_has_expected_num_blocks(3))
        .then(() => {
            rpc.disconnect_all();
            return;
        })

    .catch(err => {
        rpc.disconnect_all();
        console.error('test_build_chunks FAILED: ', err.stack || err);
        throw new Error('test_build_chunks FAILED: ', err);
    });
}


if (require.main === module) {
    main();
}
