"use strict";

let _ = require('lodash');
let P = require('../../util/promise');
let api = require('../../api');
let ops = require('./basic_server_ops');
let promise_utils = require('../../util/promise_utils');
var dotenv = require('dotenv');
var fs = require('fs');
const util = require('util');
var AWS = require('aws-sdk');
dotenv.load();


let TEST_CTX = {
    ip: '127.0.0.1',
    default_bucket: 'files',
    object_key: '',
    timeout: 60,
    discard_pool_name: 'default_pool',
    default_tier_name: 'test_tier',
    default_tier_policy_name: 'tiering1',
    cloud_pool_name: 'cloud-pool-aws'
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
        password: 'DeMo1',
        system: 'demo'
    };
    return P.fcall(function() {
        return client.create_auth_token(auth_params);
    });
}

function upload_random_file(size_mb, bucket_name, extension, content_type) {
    return ops.generate_random_file(size_mb, extension)
        .then(fname => {
            TEST_CTX.object_key = fname;
            var s3bucket = new AWS.S3({
                endpoint: `http://${TEST_CTX.ip}:80/`,
                credentials: {
                    accessKeyId: '123',
                    secretAccessKey: 'abc'
                },
                s3ForcePathStyle: true,
                sslEnabled: false
            });
            return P.ninvoke(s3bucket, 'upload', {
                Bucket: bucket_name,
                Key: fname,
                Body: fs.createReadStream(fname),
                ContentType: content_type
            });
        });
}

function verify_object_health(expected_num_blocks, bucket_name, pool_names, cloud_pool, video_optimization) {
    console.log(`verifying object ${TEST_CTX.object_key} health. expected num of blocks: ${expected_num_blocks}`);
    let num_blocks = 0;
    let num_parts = 0;
    let num_blocks_per_part = 0;
    let expected_num_vid_blocks = video_optimization ? expected_num_blocks * 4 : 0;
    let num_vid_blocks = 0;
    let start_ts = Date.now();
    return client.node.list_nodes({
            query: {
                pools: pool_names,
                skip_internal: !cloud_pool
            }
        })
        .then(node_list => promise_utils.pwhile(() => num_blocks_per_part.toFixed(0) < expected_num_blocks || num_vid_blocks < expected_num_vid_blocks,
            () => client.object.read_object_mappings({
                bucket: bucket_name,
                key: TEST_CTX.object_key,
                adminfo: cloud_pool
            })
            .then(obj_mapping => {
                let node_ids = _.filter(node_list.nodes, node => !node.has_issues).map(node => node._id);
                let cloud_node_ids = cloud_pool ? (_.filter(node_list.nodes, node => node.is_cloud_node).map(node => node._id)) : undefined;
                num_blocks = 0;
                num_parts = 0;
                num_vid_blocks = 0;
                num_vid_blocks += obj_mapping.parts[0].chunk.frags[0].blocks.length;
                num_vid_blocks += obj_mapping.parts[obj_mapping.parts.length - 1].chunk.frags[0].blocks.length;
                _.each(obj_mapping.parts, part => {
                    var distinct_nodes_per_part = new Set();
                    num_parts += 1;
                    _.each(part.chunk.frags[0].blocks, block => {
                        if (!distinct_nodes_per_part.has(block.block_md.node)) {
                            if (cloud_pool && _.includes(cloud_node_ids, block.block_md.node)) num_blocks += expected_num_blocks;
                            else if (_.includes(node_ids, block.block_md.node)) num_blocks += 1;
                        }
                        distinct_nodes_per_part.add(block.block_md.node);
                    });
                });
                num_blocks_per_part = num_blocks / num_parts || 1;
                if (num_blocks_per_part < expected_num_blocks || num_vid_blocks < expected_num_vid_blocks) {
                    let diff = Date.now() - start_ts;
                    if ((diff / 1000).toFixed(0) % 5 === 0) {
                        let msg = '';
                        let elapsed_time = (diff / 1000).toFixed(0);
                        if (num_blocks_per_part.toFixed(0) < expected_num_blocks) msg += `object has an average ${num_blocks_per_part.toFixed(0)} blocks per part. expected ${expected_num_blocks}. `;
                        if (num_vid_blocks < expected_num_vid_blocks) msg += `object has ${num_vid_blocks} blocks for video optimization. expected ${expected_num_vid_blocks}. `;
                        if (elapsed_time > 0 && elapsed_time < TEST_CTX.timeout) msg += `${elapsed_time} seconds passed. retrying for ${TEST_CTX.timeout - elapsed_time} seconds`;
                        console.warn(msg);
                    }
                    if (diff > (TEST_CTX.timeout * 1000)) {
                        throw new Error('aborted test after ' + TEST_CTX.timeout + ' seconds');
                    }
                    return P.delay(1000);
                }
            })))
        .then(() => client.object.read_object_mappings({
            bucket: bucket_name,
            key: TEST_CTX.object_key,
            adminfo: cloud_pool
        }));
}

function discard_nodes_from_pool(object_mapping, num_nodes, pool_name) {
    console.log(`decommissioning ${num_nodes} nodes from pool ${pool_name}`);
    // assuming here we have enough nodes for the test. In particular, a minimum of 6 to create a new pool.
    // creating a new pool and moving some nodes to it (ones containing some of the object's blocks).
    // marking nodes that contain the object
    let node_ids = [];
    _.each(object_mapping.parts, part => {
        _.each(part.chunk.frags[0].blocks, block => {
            if (!_.includes(node_ids, block.block_md.node)) node_ids.push(block.block_md.node);
        });
    });
    return client.node.list_nodes({
            query: {
                pools: [pool_name]
            }
        })
        .then(node_list => client.pool.assign_nodes_to_pool({
            name: TEST_CTX.discard_pool_name,
            nodes: _.slice(_.filter(node_list.nodes.map(node_info => {
                return {
                    id: node_info._id,
                    name: node_info.name,
                    peer_id: node_info.peer_id,
                    rpc_address: node_info.rpc_address
                };
            }), node => _.includes(node_ids, node.id)), 0, num_nodes)
        }));
}

function comission_nodes_to_pool(pool_name, num_nodes) {
    console.log(`commissioning ${num_nodes} nodes to pool ${pool_name}`);
    return client.node.list_nodes({
            query: {
                pools: [TEST_CTX.discard_pool_name]
            }
        })
        .then(node_list => client.pool.assign_nodes_to_pool({
            name: pool_name,
            nodes: _.slice((node_list.nodes.map(node_info => {
                return {
                    id: node_info._id,
                    name: node_info.name,
                    peer_id: node_info.peer_id,
                    rpc_address: node_info.rpc_address
                };
            })), 0, num_nodes)
        }));
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
        .then(() => test_tear_down())
        .then(() => test_rebuild_single_unavailable_block()) // at least 4 nodes
        .then(() => test_rebuild_two_unavailable_blocks()) // at least 5 nodes
        .then(() => test_rebuild_unavailable_from_mirror()) // at least 7 nodes.
        //    .then(() => test_rebuild_unavailable_from_cloud_pool())
        //    .then(() => test_rebuild_one_corrupted_block())
        //    .then(() => test_rebuild_two_corrupted_blocks())
        //    .then(() => test_rebuild_corrupted_from_mirror_pool())
        //    .then(() => test_rebuild_corrupted_from_cloud_pool())
        .then(() => test_double_blocks_on_movie_files())
        .catch(err => {
            console.error('test_build_chunks FAILED: ', err.stack || err);
            throw new Error('test_build_chunks FAILED: ', err);
        })
        .finally(() => rpc.disconnect_all());
}

function test_rebuild_single_unavailable_block() {
    console.log('running test: test_rebuild_single_unavailable_block');
    let bucket_name = 'test1bucket';
    let pool_names = ['test1pool'];
    return test_setup(bucket_name, pool_names, false, false, {
            'test1pool': 4
        })
        .then(() => upload_random_file(1, bucket_name))
        .then(() => verify_object_health(3, bucket_name, pool_names))
        .then(obj_mapping => discard_nodes_from_pool(obj_mapping, 1, 'test1pool'))
        .then(() => verify_object_health(3, bucket_name, pool_names))
        .then(() => console.log('test test_rebuild_single_unavailable_block successful'))
        .catch(err => console.error(`Had error in test test_rebuild_single_unavailable_block: ${err}`))
        .finally(() => test_tear_down());
}

function test_rebuild_two_unavailable_blocks() {
    console.log('running test: test_rebuild_two_unavailable_blocks');
    let bucket_name = 'test2bucket';
    let pool_names = ['test2pool'];
    return test_setup(bucket_name, pool_names, false, false, {
            'test2pool': 5
        })
        .then(() => upload_random_file(5, bucket_name))
        .then(() => verify_object_health(3, bucket_name, pool_names))
        .then(obj_mapping => discard_nodes_from_pool(obj_mapping, 2, 'test2pool'))
        .then(() => verify_object_health(3, bucket_name, pool_names))
        .then(() => console.log('test test_rebuild_two_unavailable_blocks successful'))
        .catch(err => console.error(`Had error in test test_rebuild_two_unavailable_blocks: ${err}`))
        .finally(() => test_tear_down());
}

function test_rebuild_unavailable_from_mirror() {
    console.log('running test: test_rebuild_unavailable_from_mirror');
    let bucket_name = 'test3bucket';
    let pool_names = ['test3pool1', 'test3pool2'];
    return test_setup(bucket_name, pool_names, true, false, {
            'test3pool1': 4,
            'test3pool2': 3
        })
        .then(() => upload_random_file(7, bucket_name))
        .then(() => verify_object_health(6, bucket_name, pool_names))
        .then(obj_mapping => discard_nodes_from_pool(obj_mapping, 1, 'test3pool1'))
        .then(() => verify_object_health(6, bucket_name, pool_names))
        .then(() => console.log('test test_rebuild_unavailable_from_mirror successful'))
        .catch(err => console.error(`Had error in test test_rebuild_unavailable_from_mirror: ${err}`))
        .finally(() => test_tear_down());
}

function test_rebuild_unavailable_from_cloud_pool() {
    console.log('running test: test_rebuild_unavailable_from_cloud_pool');
    let bucket_name = 'test4bucket';
    let pool_names = ['test4pool1'];
    let cloud_pool_name = TEST_CTX.cloud_pool_name;
    return test_setup(bucket_name, pool_names, false, true, {
            'test4pool1': 3
        })
        .then(() => upload_random_file(1, bucket_name))
        .then(() => verify_object_health(3, bucket_name, pool_names.concat(cloud_pool_name), true))
        .then(obj_mapping => [obj_mapping, comission_nodes_to_pool(pool_names[0], 3)])
        .spread(obj_mapping => discard_nodes_from_pool(obj_mapping, 3, pool_names[0]))
        .then(() => verify_object_health(3, bucket_name, pool_names.concat(cloud_pool_name), true))
        .then(() => console.log('test test_rebuild_unavailable_from_cloud_pool successful'))
        .catch(err => console.error(`Had error in test test_rebuild_unavailable_from_cloud_pool: ${err}`))
        .finally(() => test_tear_down());
}

function test_double_blocks_on_movie_files() {
    console.log('running test: test_double_blocks_on_movie_files');
    let bucket_name = 'test9bucket';
    let pool_names = ['test9pool1'];
    return test_setup(bucket_name, pool_names, false, false, {
            'test1pool': 4
        })
        .then(() => upload_random_file(4, bucket_name, 'mp4', 'video/mp4'))
        .then(() => verify_object_health(3, bucket_name, pool_names, false, true))
        .then(() => console.log('test test_double_blocks_on_movie_files successful'))
        .catch(err => console.error(`Had error in test test_double_blocks_on_movie_files: ${err}`))
        .finally(() => test_tear_down());
}

function test_setup(bucket_name, pool_names, mirrored, cloud_pool, num_of_nodes_per_pool) {
    console.log(`test setup: bucket name: ${bucket_name}, pool names: ${pool_names}${mirrored ? ", mirrored" : ""}${cloud_pool ? ", from cloud pool" : ""}${num_of_nodes_per_pool ? ", node configuration: " + util.inspect(num_of_nodes_per_pool) : ""}`);
    return P.map(pool_names.map(pool_name => {
                return {
                    name: pool_name
                };
            }), pool_to_create => client.node.list_nodes({
                query: {
                    online: true,
                    pools: [TEST_CTX.discard_pool_name]
                }
            })
            .then(node_list => {
                pool_to_create.nodes = _.slice(node_list.nodes, 0, num_of_nodes_per_pool[pool_to_create.name]).map(node_info => {
                    return {
                        id: node_info._id,
                        name: node_info.name,
                        peer_id: node_info.peer_id,
                        rpc_address: node_info.rpc_address
                    };
                });
                return client.pool.create_nodes_pool(pool_to_create);
            }), {
                concurrency: 1
            }
        )
        .then(() => cloud_pool && client.account.add_account_sync_credentials_cache({
                name: 'test_build_chunks_cloud',
                endpoint_type: 'AWS',
                endpoint: 'https://s3.amazonaws.com',
                identity: 'AKIAIGLTF7IWOW4M3ZHQ',
                secret: '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'
            })
            .then(() => client.pool.create_cloud_pool({
                name: TEST_CTX.cloud_pool_name,
                connection: 'test_build_chunks_cloud',
                target_bucket: 'ca-tester',
            }))
            .then(() => promise_utils.retry(24, 5000, () => has_expected_num_nodes(TEST_CTX.cloud_pool_name, 1))))
        .then(() => client.tier.create_tier({
            name: TEST_CTX.default_tier_name,
            node_pools: pool_names,
            cloud_pools: cloud_pool ? [TEST_CTX.cloud_pool_name] : undefined,
            data_placement: mirrored ? 'MIRROR' : 'SPREAD'
        }))
        .then(() => client.tiering_policy.create_policy({
            name: TEST_CTX.default_tier_policy_name,
            tiers: [{
                order: 0,
                tier: TEST_CTX.default_tier_name
            }]
        }))
        .then(() => client.bucket.create_bucket({
            name: bucket_name,
            tiering: TEST_CTX.default_tier_policy_name,
        }));
}


function has_expected_num_nodes(pool_name, num_of_nodes) {
    return client.node.list_nodes({
            query: {
                pools: [pool_name]
            }
        })
        .then(nodes_list => {
            if (nodes_list.nodes.length === num_of_nodes) return P.resolve();
            let msg = `pool ${pool_name} has ${nodes_list.nodes.length} nodes. expected: ${num_of_nodes}`;
            console.warn(msg);
            return P.reject(new Error(msg));
        });
}

function delete_bucket_content(bucket_name) {
    return client.object.list_objects({
            bucket: bucket_name
        })
        .then(object_list => P.map(object_list.objects, obj => client.object.delete_object({
            bucket: bucket_name,
            key: obj.key
        }), {
            concurrency: 10
        }));
}

function test_tear_down() {
    console.log(`Cleaning up for next test.`);
    return client.bucket.list_buckets()
        .then(bucket_list => P.map(bucket_list.buckets, bucket => { // lol bucket list
            if (bucket.name === TEST_CTX.default_bucket) return delete_bucket_content(bucket.name);
            return delete_bucket_content(bucket.name)
                .then(() => client.bucket.delete_bucket({
                    name: bucket.name
                }));
        }))
        .then(() => client.system.read_system())
        .then(system => {
            let pools_to_delete = [];
            _.each(system.pools, pool => {
                if (pool.name !== 'default_pool') {
                    pools_to_delete.push(client.node.list_nodes({
                            query: {
                                pools: [pool.name]
                            }
                        })
                        .then(node_list => pool.cloud_info || // making sure not to assign cloud pool nodes to default_pool
                            client.pool.assign_nodes_to_pool({
                                name: TEST_CTX.discard_pool_name,
                                nodes: node_list.nodes.map(node_object => {
                                    return {
                                        id: node_object._id,
                                        name: node_object.name,
                                        peer_id: node_object.peer_id,
                                        rpc_address: node_object.rpc_address
                                    };
                                })
                            })
                        )
                        .then(() => client.pool.delete_pool({
                            name: pool.name
                        })));
                }
            });
            return P.all(pools_to_delete);
        });
}

if (require.main === module) {
    main();
}
