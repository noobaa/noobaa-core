/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const AWS = require('aws-sdk');
const util = require('util');
const crypto = require('crypto');

const P = require('../../util/promise');
const api = require('../../api');
const ops = require('../utils/basic_server_ops');
const config = require('../../../config.js');
const dotenv = require('../../util/dotenv');
const ObjectIO = require('../../sdk/object_io');
const test_utils = require('./test_utils');
const promise_utils = require('../../util/promise_utils');
const { RPC_BUFFERS } = require('../../rpc');

dotenv.load();

let TEST_CTX = {
    ip: '127.0.0.1',
    default_bucket: 'first.bucket',
    object_key: '',
    timeout: 120,
    discard_pool_name: config.NEW_SYSTEM_POOL_NAME,
    default_tier_name: 'test_tier',
    default_tier_policy_name: 'tiering1',
    cloud_pool_name: 'cloud-pool-aws'
};

let rpc = api.new_rpc(); //'ws://' + argv.ip + ':8080');
let client = rpc.new_client({
    address: 'ws://' + TEST_CTX.ip + ':' + process.env.PORT
});
let n2n_agent = rpc.register_n2n_agent(client.node.n2n_signal);
n2n_agent.set_any_rpc_address();



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

const AWS_s3 = new AWS.S3({
    // endpoint: 'https://s3.amazonaws.com',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    },
    s3ForcePathStyle: true,
    sslEnabled: false,
    signatureVersion: 'v4',
    // region: 'eu-central-1'
});

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

function get_cloud_block_ids(obj_mapping) {
    let cloud_block_ids = [];
    _.each(obj_mapping.parts, part => {
        cloud_block_ids = cloud_block_ids.concat(
            _.filter(part.chunk.frags[0].blocks,
                block => block.adminfo && block.adminfo.in_cloud_pool));
    });
    return cloud_block_ids;
}


function verify_object_health(expected_num_blocks, bucket_name, pool_names, cloud_pool, test_corruption) {
    console.log(`verifying object ${TEST_CTX.object_key} health. expected num of blocks: ${expected_num_blocks}`);
    let num_blocks = 0;
    let num_parts = 0;
    let num_blocks_per_part = 0;
    let obj_is_invalid = true;
    let obj_is_verified = !test_corruption;
    let obj_mapping = {};
    let start_ts = Date.now();
    return client.node.list_nodes({
            query: {
                pools: pool_names,
                skip_internal: !cloud_pool,
                skip_mongo_nodes: true
            }
        })
        .then(node_list => promise_utils.pwhile(() => obj_is_invalid || !obj_is_verified,
            () => client.object.read_object_mapping({
                bucket: bucket_name,
                key: TEST_CTX.object_key,
                adminfo: Boolean(cloud_pool)
            })
            .then(object_mapping => {
                obj_mapping = object_mapping;
            })
            .then(() => {
                // This checks for tempering
                if (!obj_is_verified) {
                    let object_io_verifier = new ObjectIO();
                    object_io_verifier.set_verification_mode();
                    return object_io_verifier.read_object({
                            client: client,
                            bucket: bucket_name,
                            key: TEST_CTX.object_key,
                            start: 0,
                            end: obj_mapping.object_md.size
                        })
                        .then(() => {
                            obj_is_verified = true;
                        })
                        .catch(err => {
                            console.warn(`object could not be verified.`, err);
                            obj_is_verified = false;
                        });
                }
            })
            .then(() => {
                // This will check the number of distinct nodes that hold the object's blocks are all mapped to expected pools
                let node_ids = _.filter(node_list.nodes, node => !node.has_issues)
                    .map(node => node._id);
                let cloud_node_ids = cloud_pool ?
                    (_.filter(node_list.nodes, node => node.is_cloud_node)
                        .map(node => node._id)) :
                    undefined;
                num_blocks = 0;
                num_parts = 0;
                _.each(obj_mapping.parts, part => {
                    var distinct_nodes_per_part = new Set();
                    num_parts += 1;
                    _.each(part.chunk.frags[0].blocks, block => {
                        if (!distinct_nodes_per_part.has(block.block_md.node)) {
                            if (_.includes(node_ids, block.block_md.node) ||
                                (cloud_pool && _.includes(cloud_node_ids, block.block_md.node))) {
                                num_blocks += 1;
                            }
                        }
                        distinct_nodes_per_part.add(block.block_md.node);
                    });
                });
                num_blocks_per_part = num_blocks / num_parts || 1;
                obj_is_invalid = !obj_is_verified ||
                    num_blocks_per_part.toFixed(0) < expected_num_blocks ||
                    (cloud_pool && !cloud_node_ids);
                if (obj_is_invalid) {
                    let diff = Date.now() - start_ts;
                    print_verification_warning(diff, num_blocks_per_part,
                        expected_num_blocks, obj_is_verified);
                    if (diff > (TEST_CTX.timeout * 1000)) {
                        throw new Error('aborted test after ' + TEST_CTX.timeout + ' seconds');
                    }
                    return P.delay(1000);
                }
            })))
        .then(() => {
            if (cloud_pool) {
                return test_utils.blocks_exist_on_cloud(get_cloud_block_ids(obj_mapping), AWS_s3);
            }
        })
        .then(() => {
            console.log('object health verified');
            return client.object.read_object_mapping({
                bucket: bucket_name,
                key: TEST_CTX.object_key,
                adminfo: Boolean(cloud_pool)
            });
        });
}

function print_verification_warning(diff, num_blocks_per_part, expected_num_blocks, obj_is_verified) {
    if ((diff / 1000).toFixed(0) % 5 === 0) {
        let msg = '';
        let elapsed_time = (diff / 1000).toFixed(0);
        if (!obj_is_verified) {
            msg += `object integrity check failed. `;
        }
        if (num_blocks_per_part.toFixed(0) < expected_num_blocks) {
            msg += `object has an average ${num_blocks_per_part.toFixed(0)} blocks per part. expected ${expected_num_blocks}. `;
        }
        if (elapsed_time > 0 && elapsed_time < TEST_CTX.timeout) {
            msg += `${elapsed_time} seconds passed. retrying for ${TEST_CTX.timeout - elapsed_time} seconds`;
        }
        console.warn(msg);
    }
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
                pools: [pool_name],
                skip_mongo_nodes: true
            }
        })
        .then(node_list => client.pool.assign_nodes_to_pool({
            name: TEST_CTX.discard_pool_name,
            nodes: _.slice(_.filter(node_list.nodes.map(node_info => ({
                id: node_info._id,
                name: node_info.name,
                peer_id: node_info.peer_id,
                rpc_address: node_info.rpc_address
            })), node => _.includes(node_ids, node.id)), 0, num_nodes)
        }));
}

function comission_nodes_to_pool(pool_name, num_nodes) {
    console.log(`commissioning ${num_nodes} nodes to pool ${pool_name}`);
    return client.node.list_nodes({
            query: {
                pools: [TEST_CTX.discard_pool_name],
                skip_mongo_nodes: true
            }
        })
        .then(node_list => client.pool.assign_nodes_to_pool({
            name: pool_name,
            nodes: _.slice((node_list.nodes.map(node_info => ({
                id: node_info._id,
                name: node_info.name,
                peer_id: node_info.peer_id,
                rpc_address: node_info.rpc_address
            }))), 0, num_nodes)
        }));
}

function corrupt_a_block(object_mapping, num_blocks) {
    console.log(`corrupt_a_block: corrupting ${num_blocks} blocks`);
    num_blocks = num_blocks || 1;
    const data = crypto.randomBytes(512);
    let block_mds = [];
    for (let i = 0; i < num_blocks; i++) {
        if (object_mapping.parts[0].chunk.frags[0].blocks[i]) {
            block_mds.push(object_mapping.parts[0].chunk.frags[0].blocks[i].block_md);
        }
    }
    return P.map(block_mds, block_md => {
        console.log(`corrupt_a_block: corrupted block_md:`, block_md);
        block_md.digest_type = 'sha1';
        block_md.digest_b64 = crypto.createHash(block_md.digest_type).update(data).digest('base64');
        return client.block_store.write_block({
            [RPC_BUFFERS]: { data },
            block_md,
        }, {
            address: block_md.address
        });
    });
}


function main() {
    return run_test()
        .then(function() {
            process.exit(0);
        })
        .catch(function(err) {
            console.warn('error while running test. ', err);
            process.exit(1);
        });
}

function run_test() {
    return authenticate()
        .then(() => test_tear_down())
        .then(() => test_rebuild_single_unavailable_block()) // at least 4 nodes required
        .then(() => test_rebuild_two_unavailable_blocks()) // at least 5 nodes required
        .then(() => test_rebuild_unavailable_from_mirror()) // at least 7 nodes required
        .then(() => false && test_rebuild_unavailable_from_cloud_pool()) // at least 6 nodes required                     // TODO: fix #2116
        .then(() => false && test_rebuild_one_corrupted_block()) // at least 3 nodes required                             // TODO: fix #2114
        .then(() => false && test_rebuild_two_corrupted_blocks()) // at least 3 nodes required. corrupts 2 node           // TODO: fix #2114
        .then(() => false && test_rebuild_corrupted_from_mirror()) // at least 6 nodes required. corrupts 3 nodes         // TODO: fix #2114
        .then(() => false && test_rebuild_corrupted_from_cloud_pool()) // at least 3 nodes required. corrupts 3 nodes     // TODO: fix #2114 && #2090
        .then(() => console.log('test test_build_chunks SUCCESS'))
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
        .catch(err => {
            console.error(`Had error in test test_rebuild_single_unavailable_block: ${err}`);
            throw err;
        })
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
        .catch(err => {
            console.error(`Had error in test test_rebuild_two_unavailable_blocks: ${err}`);
            throw err;
        })
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
        .catch(err => {
            console.error(`Had error in test test_rebuild_unavailable_from_mirror: ${err}`);
            throw err;
        })
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
        .then(() => verify_object_health(4, bucket_name, pool_names.concat(cloud_pool_name), TEST_CTX.cloud_pool_name))
        .then(obj_mapping => [obj_mapping, comission_nodes_to_pool(pool_names[0], 3)])
        .spread(obj_mapping => discard_nodes_from_pool(obj_mapping, 3, pool_names[0]))
        .then(() => verify_object_health(4, bucket_name, pool_names.concat(cloud_pool_name), TEST_CTX.cloud_pool_name))
        .then(() => console.log('test test_rebuild_unavailable_from_cloud_pool successful'))
        .catch(err => {
            console.error(`Had error in test test_rebuild_unavailable_from_cloud_pool: ${err}`);
            throw err;
        })
        .finally(() => test_tear_down());
}

function test_rebuild_one_corrupted_block() {
    console.log('running test: test_rebuild_one_corrupted_block');
    let bucket_name = 'testbucket';
    let pool_names = ['test5pool'];
    return test_setup(bucket_name, pool_names, false, false, {
            'test5pool': 3
        })
        .then(() => upload_random_file(1, bucket_name))
        .then(() => verify_object_health(3, bucket_name, pool_names, false, true))
        .then(obj_mapping => corrupt_a_block(obj_mapping))
        .then(() => verify_object_health(3, bucket_name, pool_names, false, true))
        .then(() => console.log('test test_rebuild_one_corrupted_block successful'))
        .catch(err => {
            console.error(`Had error in test test_rebuild_one_corrupted_block: ${err}`);
            throw err;
        })
        .finally(() => test_tear_down());
}

function test_rebuild_two_corrupted_blocks() {
    console.log('running test: test_rebuild_two_corrupted_blocks');
    let bucket_name = 'test6bucket';
    let pool_names = ['tes6pool'];
    return test_setup(bucket_name, pool_names, false, false, {
            'test6pool': 3
        })
        .then(() => upload_random_file(2, bucket_name))
        .then(() => verify_object_health(3, bucket_name, pool_names, false, true))
        .then(obj_mapping => corrupt_a_block(obj_mapping))
        .then(() => verify_object_health(3, bucket_name, pool_names, false, true))
        .then(() => console.log('test test_rebuild_two_corrupted_blocks successful'))
        .catch(err => {
            console.error(`Had error in test test_rebuild_two_corrupted_blocks: ${err}`);
            throw err;
        })
        .finally(() => test_tear_down());
}

function test_rebuild_corrupted_from_mirror() {
    console.log('running test: test_rebuild_corrupted_from_mirror');
    let bucket_name = 'test7bucket';
    let pool_names = ['test7pool1', 'test7pool2'];
    return test_setup(bucket_name, pool_names, true, false, {
            'test7pool1': 3,
            'test7pool2': 3
        })
        .then(() => upload_random_file(2, bucket_name))
        .then(() => verify_object_health(6, bucket_name, pool_names, false, true))
        .then(obj_mapping => corrupt_a_block(obj_mapping), 2)
        .then(() => verify_object_health(6, bucket_name, pool_names, false, true))
        .then(() => console.log('test test_rebuild_corrupted_from_mirror successful'))
        .catch(err => {
            console.error(`Had error in test test_rebuild_corrupted_from_mirror: ${err}`);
            throw err;
        })
        .finally(() => test_tear_down());
}

function test_rebuild_corrupted_from_cloud_pool() {
    console.log('running test: test_rebuild_corrupted_from_cloud_pool');
    let bucket_name = 'test8bucket';
    let pool_names = ['test8pool1'];
    let cloud_pool_name = TEST_CTX.cloud_pool_name;
    return test_setup(bucket_name, pool_names, false, true, {
            'test8pool1': 3
        })
        .then(() => upload_random_file(1, bucket_name))
        .then(() => verify_object_health(4, bucket_name, pool_names.concat(cloud_pool_name), TEST_CTX.cloud_pool_name, true))
        .then(obj_mapping => [obj_mapping, comission_nodes_to_pool(pool_names[0], 3)])
        .spread(obj_mapping => corrupt_a_block(obj_mapping), 3)
        .then(() => verify_object_health(4, bucket_name, pool_names.concat(cloud_pool_name), TEST_CTX.cloud_pool_name, true))
        .then(() => console.log('test test_rebuild_corrupted_from_cloud_pool successful'))
        .catch(err => {
            console.error(`Had error in test test_rebuild_corrupted_from_cloud_pool: ${err}`);
            throw err;
        })
        .finally(() => test_tear_down());
}

function test_setup(bucket_name, pool_names, mirrored, cloud_pool, num_of_nodes_per_pool) {
    console.log(`test setup: bucket name: ${bucket_name}, pool names: ${pool_names}${mirrored ? ", mirrored" : ""}${cloud_pool ? ", from cloud pool" : ""}${num_of_nodes_per_pool ? ", node configuration: " + util.inspect(num_of_nodes_per_pool) : ""}`);
    return P.each(pool_names, pool_name => {
            const ATTEMPTS = 10;
            const DELAY = 30 * 1000;
            // if not enough nodes, keep retrying for ~5 minutes 
            return promise_utils.retry(ATTEMPTS, DELAY, () => client.node.list_nodes({
                        query: {
                            // has_issues: false,
                            pools: [TEST_CTX.discard_pool_name],
                            skip_mongo_nodes: true
                        }
                    })
                    .then(node_list => {
                        if (!node_list || !node_list.nodes) throw new Error('not enough nodes');
                        const valid_nodes = node_list.nodes.filter(node => node.mode === 'OPTIMAL');
                        if (valid_nodes.length < num_of_nodes_per_pool[pool_name]) {
                            console.log(`list nodes returned ${valid_nodes.length} nodes. required number by ${pool_name} is ${num_of_nodes_per_pool[pool_name]}.`,
                                node_list.nodes.map(node => ({ name: node.name, mode: node.mode })));
                            throw new Error('not enough nodes');
                        }
                        return valid_nodes;
                    })
                )
                .catch(() => {
                    console.error('failed getting enough nodes');
                    process.exit(1);
                })
                .then(node_list => {
                    const pool_to_create = {
                        name: pool_name,
                    };
                    pool_to_create.nodes = _.slice(node_list, 0, num_of_nodes_per_pool[pool_to_create.name]).map(node_info => ({
                        id: node_info._id,
                        name: node_info.name,
                        peer_id: node_info.peer_id,
                        rpc_address: node_info.rpc_address
                    }));
                    return client.pool.create_nodes_pool(pool_to_create);
                });
        })
        .then(() => cloud_pool && client.account.add_external_connection({
                name: 'test_build_chunks_cloud',
                endpoint_type: 'AWS',
                endpoint: 'https://s3.amazonaws.com',
                identity: process.env.AWS_ACCESS_KEY_ID,
                secret: process.env.AWS_SECRET_ACCESS_KEY
            })
            .then(() => client.pool.create_cloud_pool({
                name: TEST_CTX.cloud_pool_name,
                connection: 'test_build_chunks_cloud',
                target_bucket: 'ca-tester',
            }))
            .then(() => promise_utils.retry(24, 5000, () => has_expected_num_nodes(TEST_CTX.cloud_pool_name, 1))))
        .then(() => client.tier.create_tier({
            name: TEST_CTX.default_tier_name,
            attached_pools: cloud_pool ? _.concat(pool_names, [TEST_CTX.cloud_pool_name]) : pool_names,
            // cloud_pools: cloud_pool ? [TEST_CTX.cloud_pool_name] : undefined,
            data_placement: mirrored ? 'MIRROR' : 'SPREAD'
        }))
        .then(() => client.tiering_policy.create_policy({
            name: TEST_CTX.default_tier_policy_name,
            tiers: [{
                order: 0,
                tier: TEST_CTX.default_tier_name,
                spillover: false,
                disabled: false
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
                pools: [pool_name],
                skip_mongo_nodes: true
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
    return client.object.list_objects_admin({
            bucket: bucket_name
        })
        .then(object_list => P.map(object_list.objects, obj => client.object.delete_object({
            bucket: bucket_name,
            key: obj.key,
            version_id: obj.version_id,
        }), {
            concurrency: 10
        }));
}

function test_tear_down() {
    console.log(`Cleaning up for next test.`);
    return client.bucket.list_buckets()
        .then(bucket_list => P.map(bucket_list.buckets, bucket => { // lol bucket list
            if (bucket.name.unwrap() === TEST_CTX.default_bucket) return delete_bucket_content(bucket.name);
            return delete_bucket_content(bucket.name)
                .then(() => client.bucket.delete_bucket({
                    name: bucket.name
                }));
        }))
        .then(() => client.system.read_system())
        .then(system => {
            let pools_to_delete = [];
            _.each(system.pools, pool => {
                if (pool.name !== config.NEW_SYSTEM_POOL_NAME && pool.name.indexOf(config.INTERNAL_STORAGE_POOL_NAME) === -1) {
                    pools_to_delete.push(client.node.list_nodes({
                            query: {
                                pools: [pool.name],
                                skip_mongo_nodes: true
                            }
                        })
                        .then(node_list => pool.cloud_info || // making sure not to assign cloud pool nodes to first.pool
                            client.pool.assign_nodes_to_pool({
                                name: TEST_CTX.discard_pool_name,
                                nodes: node_list.nodes.map(node_object => ({
                                    id: node_object._id,
                                    name: node_object.name,
                                    peer_id: node_object.peer_id,
                                    rpc_address: node_object.rpc_address
                                }))
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
