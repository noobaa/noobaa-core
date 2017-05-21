/* Copyright (C) 2016 NooBaa */
"use strict";

var basic_server_ops = require('./basic_server_ops');
var config = require('../../../config');
var P = require('../../util/promise');
var api = require('../../api');
var argv = require('minimist')(process.argv);
var _ = require('lodash');
var dotenv = require('../../util/dotenv');
var promise_utils = require('../../util/promise_utils');
dotenv.load();

argv.ip = argv.ip || '127.0.0.1';
argv.access_key = argv.access_key || '123';
argv.secret_key = argv.secret_key || 'abc';
var rpc = api.new_rpc();
var client = rpc.new_client({
    address: 'ws://' + argv.ip + ':' + process.env.PORT
});

module.exports = {
    run_test: run_test
};

// Does the Auth and returns the nodes in the system
function get_nodes_auth() {
    var auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return P.fcall(function() {
            return client.create_auth_token(auth_params);
        })
        .then(function() {
            return client.node.list_nodes({
                query: {
                    online: true,
                    skip_mongo_nodes: true
                }
            });
        });
}

function run_test() {
    // Used in order to get the nodes of the system
    var sys_nodes;
    // Used in order to get the key of the file
    var fkey = null;

    // Starting the test chain
    return get_nodes_auth()
        .then(function(res) {
            sys_nodes = res;
            if (sys_nodes.total_count < 6) {
                return P.reject("Not Enough Nodes For 2 Pools");
            }

            return client.pool.create_nodes_pool({
                name: "pool1",
                nodes: _.map(sys_nodes.nodes.slice(0, 3), node => _.pick(node, 'name'))
            });
        })
        .then(() => client.pool.create_nodes_pool({
            name: "pool2",
            nodes: _.map(sys_nodes.nodes.slice(3, 6), node => _.pick(node, 'name'))
        }))
        .then(() => client.tier.create_tier({
            name: 'tier1',
            attached_pools: ['pool1', 'pool2'],
            data_placement: 'SPREAD'
        }))
        .then(() => client.tiering_policy.create_policy({
            name: 'tiering1',
            tiers: [{
                order: 0,
                tier: 'tier1',
                spillover: false,
                disabled: false
            }]
        }))
        .then(() => client.bucket.create_bucket({
            name: 'bucket1',
            tiering: 'tiering1',
        }))
        .then(() => basic_server_ops.generate_random_file(20))
        .then(fl => {
            fkey = fl;
            return basic_server_ops.upload_file(argv.ip, fkey, 'bucket1', fkey);
        })
        .delay(3000)
        .catch(function(err) {
            console.log('Failed uploading file (SPREAD)', err);
            throw new Error('Failed uploading file (SPREAD) ' + err);
        })
        .then(() => client.object.read_object_mappings({
            bucket: 'bucket1',
            key: fkey,
            adminfo: true
        }))
        .then(res => {
            _.each(res.parts, part => {
                _.each(part.chunk.frags, frag => {
                    if (frag.blocks.length !== 3) {
                        throw new Error("SPREAD NOT CORRECT!");
                    }
                });
            });
            return P.resolve();
        })
        .then(() => client.tier.update_tier({
            name: 'tier1',
            data_placement: 'MIRROR'
        }))
        .then(() => basic_server_ops.generate_random_file(20))
        .then(fl => {
            fkey = fl;
            return basic_server_ops.upload_file(argv.ip, fkey, 'bucket1', fkey);
        })
        .delay(3000)
        .catch(function(err) {
            console.log('Failed uploading file (MIRROR)', err);
            throw new Error('Failed uploading file (MIRROR) ' + err);
        })
        .then(() => {
            return client.object.read_object_mappings({
                bucket: 'bucket1',
                key: fkey,
                adminfo: true
            });
        })
        .then(res => {
            _.each(res.parts, part => {
                var pool1_count = 0;
                var pool2_count = 0;
                _.each(part.chunk.frags, frag => {
                    _.each(frag.blocks, block => {
                        if (block.adminfo.pool_name === 'pool1') {
                            pool1_count += 1;
                        } else {
                            pool2_count += 1;
                        }
                    });
                });
                if (pool1_count !== 3 && pool2_count !== 3) {
                    throw new Error("MIRROR NOT CORRECT!");
                }
            });
        })
        .then(() => perform_spillover_tests(fkey))
        .then(() => {
            rpc.disconnect_all();
            return P.resolve("Test Passed! Everything Seems To Be Fine...");
        })
        .catch(err => {
            console.error('test_files_spread FAILED: ', err.stack || err);
            rpc.disconnect_all();
            throw new Error('test_files_spread FAILED: ', err);
        })
        .then(console.log, console.error);
}

function perform_spillover_tests(fkey) {
    return P.resolve()
        .then(() => update_bucket_policy_to_spillover_only())
        .then(() => check_file_validity_on_spillover(fkey))
        .then(() => perform_upload_test_without_spillover());
}

function update_bucket_policy_to_spillover_only() {
    return P.resolve()
        .then(() => client.tier.update_tier({
            name: 'tier1',
            attached_pools: [],
            data_placement: 'SPREAD'
        }))
        .then(() => client.bucket.update_bucket({
            name: 'bucket1',
            tiering: 'tiering1',
            use_internal_spillover: true
        }));
}

function check_file_validity_on_spillover(fkey) {
    let abort_timeout_sec = 3 * 60;
    let first_iteration = true;
    let blocks_correct = false;
    let start_ts;

    return promise_utils.pwhile(
        function() {
            return !blocks_correct;
        },
        function() {
            blocks_correct = true;
            return client.object.read_object_mappings({
                    bucket: 'bucket1',
                    key: fkey,
                    adminfo: true
                })
                .then(res => {
                    _.each(res.parts, part => {
                        let blocks_per_chunk_count = 0;
                        _.each(part.chunk.frags, frag => {
                            _.each(frag.blocks, block => {
                                blocks_per_chunk_count += 1;
                                if (!block.adminfo.pool_name
                                    .includes(config.INTERNAL_STORAGE_POOL_NAME)) {
                                    blocks_correct = false;
                                    console.error("check_file_validity_on_spillover BLOCK NOT IN SPILLOVER POOL");
                                }
                            });
                        });
                        if (blocks_per_chunk_count !== 1) {
                            blocks_correct = false;
                            console.error("check_file_validity_on_spillover REPLICAS ON SPILLOVER NOT CORRECT!");
                        }
                    });
                    if (blocks_correct) {
                        console.log('check_file_validity_on_spillover PASSED!');
                    } else {
                        if (first_iteration) {
                            start_ts = Date.now();
                            first_iteration = false;
                        }

                        let diff = Date.now() - start_ts;
                        if (diff > abort_timeout_sec * 1000) {
                            throw new Error('aborted check_file_validity_on_spillover after ' + abort_timeout_sec + ' seconds');
                        }
                        return P.delay(500);
                    }
                });
        });
}

function perform_upload_test_without_spillover() {
    let catch_received = false;
    const err_timeout = new Error('TIMED OUT FROM PROMISE');
    return P.resolve()
        .then(() => client.bucket.update_bucket({
            name: 'bucket1',
            tiering: 'tiering1',
            use_internal_spillover: false
        }))
        .then(() => basic_server_ops.generate_random_file(1))
        .then(fl => {
            return basic_server_ops.upload_file(argv.ip, fl, 'bucket1', fl)
                // Since upload_file has a timeout of 20minutes, we do not want to wait
                // Please fix this value in case that you change put_object in ec2_wrapper
                // We currently use 10 seconds since it is the cycle length there to retry
                .timeout(10000, err_timeout)
                .catch(err => {
                    if (err === err_timeout) {
                        console.error('DESIRED ERROR', err);
                        catch_received = true;
                    } else {
                        console.warn('UNDESIRED ERROR', err);
                    }
                })
                .then(() => {
                    if (!catch_received) {
                        console.error('SHOULD NOT SUCCEED TO UPLOAD');
                        throw new Error('SHOULD NOT SUCCEED TO UPLOAD');
                    }
                });
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
