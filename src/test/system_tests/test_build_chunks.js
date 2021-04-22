/* Copyright (C) 2016 NooBaa */
'use strict';

const argv = require('minimist')(process.argv);
const dbg = require('../../util/debug_module')(__filename);
if (argv.log_file) {
    dbg.set_log_to_file(argv.log_file);
}
dbg.set_process_name('test_build_chunks');

const _ = require('lodash');
const fs = require('fs');
const AWS = require('aws-sdk');
// const util = require('util');
// const crypto = require('crypto');

const P = require('../../util/promise');
const api = require('../../api');
const ops = require('../utils/basic_server_ops');
const dotenv = require('../../util/dotenv');
const ObjectIO = require('../../sdk/object_io');
const test_utils = require('./test_utils');
// const { RPC_BUFFERS } = require('../../rpc');

dotenv.load();

const {
    mgmt_ip = 'localhost',
        mgmt_port = '8080',
        s3_ip = 'localhost',
        s3_port = '80',
} = argv;


let TEST_CTX = {
    ip: 'localhost',
    s3_endpoint: `http://${s3_ip}:${s3_port}/`,
    default_bucket: 'first.bucket',
    object_key: '',
    timeout: 120,
    default_tier_name: 'test_tier',
    default_tier_policy_name: 'tiering1',
    cloud_pool_name: 'cloud-pool-aws',
    accounts_default_resource: 'accounts_default_resource'
};

let rpc = api.new_rpc(); //'ws://' + argv.ip + ':8080');
let client = rpc.new_client({
    address: `ws://${mgmt_ip}:${mgmt_port}`
});
let n2n_agent = rpc.register_n2n_agent((...args) => client.node.n2n_signal(...args));
n2n_agent.set_any_rpc_address();

/////// Aux Functions ////////

function authenticate() {
    return client.create_auth_token({
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    });
}

// const AWS_s3 = new AWS.S3({
//     // endpoint: 'https://s3.amazonaws.com',
//     credentials: {
//         accessKeyId: process.env.AWS_ACCESS_KEY_ID,
//         secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
//     },
//     s3ForcePathStyle: true,
//     sslEnabled: false,
//     signatureVersion: 'v4',
//     // region: 'eu-central-1'
// });

async function setup() {
    // create hosts pools
    await Promise.all([
        test_utils.create_hosts_pool(client, 'pool1', 5),
        test_utils.create_hosts_pool(client, 'pool2', 3)
    ]);


    // Create a cloud resource
    await client.account.add_external_connection({
        name: 'test_build_chunks_cloud',
        endpoint_type: 'AWS',
        endpoint: 'https://s3.amazonaws.com',
        identity: process.env.AWS_ACCESS_KEY_ID,
        secret: process.env.AWS_SECRET_ACCESS_KEY
    });
    await client.pool.create_cloud_pool({
        name: TEST_CTX.cloud_pool_name,
        connection: 'test_build_chunks_cloud',
        target_bucket: TEST_CTX.cloud_pool_name,
    });
}

async function setup_case(
    bucket_name,
    attached_pools,
    data_placement
) {
    console.log(`create_test_bucket: ${bucket_name} over pool names: ${attached_pools} as ${data_placement}`);
    const bucketInfo = await client.bucket.create_bucket({ name: bucket_name });
    await client.tier.update_tier({
        name: bucketInfo.tiering.tiers[0].tier,
        data_placement,
        attached_pools
    });
}

async function upload_random_file(size_mb, bucket_name, extension, content_type) {
    const filename = await ops.generate_random_file(size_mb, extension);
    const s3bucket = new AWS.S3({
        endpoint: TEST_CTX.s3_endpoint,
        credentials: {
            accessKeyId: '123',
            secretAccessKey: 'abc'
        },
        s3ForcePathStyle: true,
        sslEnabled: false
    });

    await P.ninvoke(s3bucket, 'upload', {
        Bucket: bucket_name,
        Key: filename,
        Body: fs.createReadStream(filename),
        ContentType: content_type
    });

    return filename;
}

function get_blocks(obj_mapping) {
    const blocks = [];
    for (const chunk of obj_mapping.chunks) {
        for (const frag of chunk.frags) {
            for (const block of frag.blocks) {
                blocks.push(block);
            }
        }
    }
    return blocks;
}

async function verify_object(obj_mapping) {
    try {
        const { bucket, key } = obj_mapping.object_md;
        const object_io_verifier = new ObjectIO();
        object_io_verifier.set_verification_mode();

        await object_io_verifier.read_object({
            client: client,
            bucket: bucket.unwrap(),
            key: key,
            start: 0,
            end: obj_mapping.object_md.size
        });
        return true;

    } catch (err) {
        console.warn(`object could not be verified.`, err);
        return false;
    }
}

function count_blocks(obj_mapping, node_ids) {
    let block_count = 0;
    for (const chunk of obj_mapping.chunks) {
        const distinct_nodes_per_part = new Set();
        for (const block of chunk.frags[0].blocks) {
            if (distinct_nodes_per_part.has(block.block_md.node)) {
                continue;
            }

            distinct_nodes_per_part.add(block.block_md.node);
            if (node_ids.includes(block.block_md.node)) {
                block_count += 1;
            }
        }
    }
    return block_count;
}

async function verify_object_health(
    filename,
    expected_num_blocks,
    bucket_name,
    pool_names,
    cloud_pool,
    test_corruption
) {
    console.log(`verifying object ${filename} health. expected num of blocks: ${expected_num_blocks}`);
    let start_ts = Date.now();
    let obj_is_valid = false;
    let obj_is_verified = !test_corruption;

    const { hosts } = await client.host.list_hosts({
        query: {
            pools: pool_names,
        }
    });

    while (!obj_is_valid) {
        const obj_mapping = await client.object.read_object_mapping_admin({
            bucket: bucket_name,
            key: filename
        });

        // This checks for tempering
        if (!obj_is_verified) {
            obj_is_verified = verify_object(obj_mapping);
        }

        // This will check the number of distinct nodes that hold the object's blocks are all mapped to expected pools
        const node_ids = hosts.storage_nodes_info.nodes
            .filter(node => !node.has_issues)
            .map(node => node._id);

        const num_blocks = count_blocks(obj_mapping, node_ids);
        const num_parts = obj_mapping.chunks.length;
        const num_blocks_per_part = Math.floor(num_blocks / num_parts) || 1;

        obj_is_valid =
            obj_is_verified &&
            num_blocks_per_part >= expected_num_blocks;

        if (!obj_is_valid) {
            const diff = Date.now() - start_ts;
            print_verification_warning(diff, num_blocks_per_part, expected_num_blocks, obj_is_verified);

            if (diff > (TEST_CTX.timeout * 1000)) {
                throw new Error('aborted test after ' + TEST_CTX.timeout + ' seconds');
            }

            await P.delay(1000);
        }
    }

    // if (cloud_pool) {
    //     const block_ids = get_blocks(mapping)
    //         .filter(block => block.block_md.pool === TEST_CTX.cloud_pool_name)
    //         .map(block => block.block_md.id);

    //     return test_utils.blocks_exist_on_cloud(false, TEST_CTX.cloud_pool_name, block_ids, AWS_s3);
    // }

    console.log('object health verified');
    return client.object.read_object_mapping_admin({
        bucket: bucket_name,
        key: filename
    });
}

function print_verification_warning(diff, num_blocks_per_part, expected_num_blocks, obj_is_verified) {
    if ((diff / 1000).toFixed(0) % 5 !== 0) {
        return;
    }
    const msg = [];
    if (!obj_is_verified) {
        msg.push(`object integrity check failed. `);
    }
    if (num_blocks_per_part.toFixed(0) < expected_num_blocks) {
        msg.push(`object has an average ${num_blocks_per_part.toFixed(0)} blocks per part. expected ${expected_num_blocks}. `);
    }

    const elapsed_time = (diff / 1000).toFixed(0);
    if (elapsed_time > 0 && elapsed_time < TEST_CTX.timeout) {
        msg.push(`${elapsed_time} seconds passed. retrying for ${TEST_CTX.timeout - elapsed_time} seconds`);
    }

    console.warn(msg.join(''));
}

async function decomission_pool_nodes(obj_mapping, num_nodes, pool_names) {
    console.log(`decommissioning ${num_nodes} nodes from pools ${pool_names}`);
    // assuming here we have enough nodes for the test. In particular, a minimum of 6 to create a new pool.
    // creating a new pool and moving some nodes to it (ones containing some of the object's blocks).
    // marking nodes that contain the object
    const node_set = new Set(get_blocks(obj_mapping)
        .map(block => block.block_md.node.toString())
    );

    const { hosts } = await client.host.list_hosts({
        query: {
            pools: pool_names
        }
    });

    const nodes = _.flatMap(hosts, host => host.storage_nodes_info.nodes);
    await Promise.all(nodes
        .filter(node => node_set.has(node._id.toString()))
        .slice(0, num_nodes)
        .map(async node => {
            const id = node._id;
            console.log(`decommissioning node: ${node.name}`);
            await client.node.decommission_node({ id });
            return P.timeout(3 * 60 * 1000, (
                async () => {
                    for (;;) {
                        const { decommissioned } = await client.node.read_node({ id });
                        if (decommissioned) break;
                    }
                    console.log(`node: ${node.name} has been decommissioned`);
                }
            )());
        })
    );
}

async function cleanup_case(bucket_name, pool_names) {
    console.log(`Cleaning up for next test.`);

    // Check if the bucket was created.
    const { buckets } = await client.bucket.list_buckets();
    if (buckets.some(bucket => bucket.name.unwrap() === bucket_name)) {
        // Empty the bucket.
        console.log(`Emptying bucket ${bucket_name}`);
        const { objects } = await client.object.list_objects({ bucket: bucket_name });
        await client.object.delete_multiple_objects({
            bucket: bucket_name,
            objects: objects.map(obj => _.pick(obj, ['key', 'version_id']))
        });

        // Delete the bucket.
        console.log(`Deleting bucket ${bucket_name}`);
        await client.bucket.delete_bucket({ name: bucket_name });
    }

    // Recommission decommissioned nodes.
    const { hosts } = await client.host.list_hosts({
        query: {
            pools: pool_names,
        }
    });
    const nodes = _.flatMap(hosts, host => host.storage_nodes_info.nodes);
    await Promise.all(nodes
        .filter(node => node.decommissioned)
        .map(node => client.node.recommission_node({ id: node._id }))
    );
}

async function run_test() {
    try {
        await authenticate();
        await setup();
        await test_rebuild_single_unavailable_block();
        await test_rebuild_two_unavailable_blocks();
        // await test_rebuild_unavailable_from_mirror(); // at least 7 nodes required
        // await test_rebuild_unavailable_from_cloud_pool(); // at least 6 nodes required                     // TODO: fix #2116
        // await test_rebuild_one_corrupted_block(); // at least 3 nodes required                             // TODO: fix #2114
        // await test_rebuild_two_corrupted_blocks(); // at least 3 nodes required. corrupts 2 node           // TODO: fix #2114
        // await test_rebuild_corrupted_from_mirror(); // at least 6 nodes required. corrupts 3 nodes         // TODO: fix #2114
        // await test_rebuild_corrupted_from_cloud_pool(); // at least 3 nodes required. corrupts 3 nodes     // TODO: fix #2114 && #2090

        console.log('test test_build_chunks SUCCESS');

    } catch (err) {
        console.error('test_build_chunks FAILED: ', err.stack || err);
        throw new Error(`test_build_chunks FAILED: ${err}`);

    } finally {
        rpc.disconnect_all();
    }
}

async function test_rebuild_single_unavailable_block() {
    console.log('running test: test_rebuild_single_unavailable_block');

    const bucket_name = 'test-bucket';
    const pool_names = ['pool1'];

    try {
        await setup_case(bucket_name, pool_names, 'MIRROR');
        const filename = await upload_random_file(1, bucket_name);
        const obj_mapping = await verify_object_health(filename, 3, bucket_name, pool_names);
        await decomission_pool_nodes(obj_mapping, 1, pool_names);
        await verify_object_health(filename, 3, bucket_name, pool_names);
        console.log('test test_rebuild_single_unavailable_block successful');

    } catch (err) {
        console.error(`Had error in test test_rebuild_single_unavailable_block: ${err}`);
        throw err;

    } finally {
        await cleanup_case(bucket_name, pool_names);
    }
}

async function test_rebuild_two_unavailable_blocks() {
    console.log('running test: test_rebuild_two_unavailable_blocks');
    const bucket_name = 'test-bucket';
    const pool_names = ['pool1'];

    try {
        await setup_case(bucket_name, pool_names, 'MIRROR');
        const filename = await upload_random_file(5, bucket_name);
        const obj_mapping = await verify_object_health(filename, 3, bucket_name, pool_names);
        await decomission_pool_nodes(obj_mapping, 2, pool_names);
        await verify_object_health(filename, 3, bucket_name, pool_names);
        console.log('test test_rebuild_two_unavailable_blocks successful');

    } catch (err) {
        console.error(`Had error in test test_rebuild_two_unavailable_blocks: ${err}`);
        throw err;

    } finally {
        await cleanup_case(bucket_name, pool_names);
    }
}

// async function test_rebuild_unavailable_from_mirror() {
//     console.log('running test: test_rebuild_unavailable_from_mirror');
//     const bucket_name = 'test3bucket';
//     const pool_names = ['test3pool1', 'test3pool2'];

//     try {
//         await test_setup(bucket_name, pool_names, true, false, {
//             'test3pool1': 4,
//             'test3pool2': 3
//         });
//         await upload_random_file(7, bucket_name);
//         const obj_mapping = await verify_object_health(6, bucket_name, pool_names);
//         await decomission_pool_nodes(obj_mapping, 1, 'test3pool1');
//         await verify_object_health(6, bucket_name, pool_names);

//         console.log('test test_rebuild_unavailable_from_mirror successful');

//     } catch (err) {
//         console.error(`Had error in test test_rebuild_unavailable_from_mirror: ${err}`);
//         throw err;

//     } finally {
//         await test_tear_down();
//     }
// }

// if (cloud_pool) {

// }

// await client.tier.create_tier({
//     name: TEST_CTX.default_tier_name,
//     attached_pools: cloud_pool ? _.concat(pool_names, [TEST_CTX.cloud_pool_name]) : pool_names,
//     // cloud_pools: cloud_pool ? [TEST_CTX.cloud_pool_name] : undefined,
//     data_placement: mirrored ? 'MIRROR' : 'SPREAD'
// });

// await client.tiering_policy.create_policy({
//     name: TEST_CTX.default_tier_policy_name,
//     tiers: [{
//         order: 0,
//         tier: TEST_CTX.default_tier_name,
//         spillover: false,
//         disabled: false
//     }]
// });

// await client.bucket.create_bucket({
//     name: bucket_name,
//     tiering: TEST_CTX.default_tier_policy_name,
// });

// function scale_pool(pool_name, host_count) {
//     console.log(`Scaling pool ${pool_name} to ${host_count} hosts`);
//     return client.pool.scale_hosts_pool({
//         name: pool_name,
//         host_count: host_count
//     });
// }

// function corrupt_a_block(object_mapping, num_blocks) {
//     console.log(`corrupt_a_block: corrupting ${num_blocks} blocks`);
//     num_blocks = num_blocks || 1;
//     const data = crypto.randomBytes(512);
//     let block_mds = [];
//     for (let i = 0; i < num_blocks; i++) {
//         if (object_mapping.parts[0].chunk.frags[0].blocks[i]) {
//             block_mds.push(object_mapping.parts[0].chunk.frags[0].blocks[i].block_md);
//         }
//     }
//     return Promise.all(block_mds.map(block_md => {
//         console.log(`corrupt_a_block: corrupted block_md:`, block_md);
//         block_md.digest_type = 'sha1';
//         block_md.digest_b64 = crypto.createHash(block_md.digest_type).update(data).digest('base64');
//         return client.block_store.write_block({
//             [RPC_BUFFERS]: { data },
//             block_md,
//         }, {
//             address: block_md.address
//         });
//     }));
// }

// async function test_rebuild_unavailable_from_cloud_pool() {
//     console.log('running test: test_rebuild_unavailable_from_cloud_pool');
//     const bucket_name = 'test4bucket';
//     const pool_names = ['test4pool1'];
//     const cloud_pool_name = TEST_CTX.cloud_pool_name;

//     try {
//         await test_setup(bucket_name, pool_names, false, true, { 'test4pool1': 3 });
//         await upload_random_file(1, bucket_name);
//         const obj_mapping = await verify_object_health(4, bucket_name, pool_names.concat(cloud_pool_name), TEST_CTX.cloud_pool_name);
//         await scale_pool(pool_names[0], 6);
//         await decomission_pool_nodes(obj_mapping, 3, 'test4pool1');
//         await verify_object_health(4, bucket_name, pool_names.concat(cloud_pool_name), TEST_CTX.cloud_pool_name);
//         console.log('test test_rebuild_unavailable_from_cloud_pool successful');

//     } catch (err) {
//         console.error(`Had error in test test_rebuild_unavailable_from_cloud_pool: ${err}`);
//         throw err;

//     } finally {
//         await test_tear_down();
//     }
// }

// async function test_rebuild_one_corrupted_block() {
//     console.log('running test: test_rebuild_one_corrupted_block');
//     const bucket_name = 'testbucket';
//     const pool_names = ['test5pool'];

//     try {
//         await test_setup(bucket_name, pool_names, false, false, { 'test5pool': 3 });
//         await upload_random_file(1, bucket_name);
//         const obj_mapping = await verify_object_health(3, bucket_name, pool_names, false, true);
//         await corrupt_a_block(obj_mapping);
//         await verify_object_health(3, bucket_name, pool_names, false, true);
//         console.log('test test_rebuild_one_corrupted_block successful');

//     } catch (err) {
//         console.error(`Had error in test test_rebuild_one_corrupted_block: ${err}`);
//         throw err;

//     } finally {
//         await test_tear_down();
//     }
// }

// async function test_rebuild_two_corrupted_blocks() {
//     console.log('running test: test_rebuild_two_corrupted_blocks');
//     const bucket_name = 'test6bucket';
//     const pool_names = ['tes6pool'];

//     try {
//         await test_setup(bucket_name, pool_names, false, false, { 'test6pool': 3 });
//         await upload_random_file(2, bucket_name);
//         const obj_mapping = await verify_object_health(3, bucket_name, pool_names, false, true);
//         await corrupt_a_block(obj_mapping);
//         await verify_object_health(3, bucket_name, pool_names, false, true);
//         console.log('test test_rebuild_two_corrupted_blocks successful');
//     } catch (err) {
//         console.error(`Had error in test test_rebuild_two_corrupted_blocks: ${err}`);
//         throw err;

//     } finally {
//         await test_tear_down();
//     }
// }

// async function test_rebuild_corrupted_from_mirror() {
//     console.log('running test: test_rebuild_corrupted_from_mirror');
//     const bucket_name = 'test7bucket';
//     const pool_names = ['test7pool1', 'test7pool2'];

//     try {
//         await test_setup(bucket_name, pool_names, true, false, {
//             'test7pool1': 3,
//             'test7pool2': 3
//         });
//         await upload_random_file(2, bucket_name);
//         const obj_mapping = await verify_object_health(6, bucket_name, pool_names, false, true);
//         await corrupt_a_block(obj_mapping, 2);
//         await verify_object_health(6, bucket_name, pool_names, false, true);
//         console.log('test test_rebuild_corrupted_from_mirror successful');

//     } catch (err) {
//         console.error(`Had error in test test_rebuild_corrupted_from_mirror: ${err}`);
//         throw err;

//     } finally {
//         await test_tear_down();
//     }
// }

// async function test_rebuild_corrupted_from_cloud_pool() {
//     console.log('running test: test_rebuild_corrupted_from_cloud_pool');
//     const bucket_name = 'test8bucket';
//     const pool_names = ['test8pool1'];
//     const cloud_pool_name = TEST_CTX.cloud_pool_name;

//     try {
//         await test_setup(bucket_name, pool_names, false, true, { 'test8pool1': 3 });
//         await upload_random_file(1, bucket_name);
//         const obj_mapping = await verify_object_health(4, bucket_name, pool_names.concat(cloud_pool_name), TEST_CTX.cloud_pool_name, true);
//         await scale_pool('test8pool1', 6);
//         await corrupt_a_block(obj_mapping, 3);
//         await verify_object_health(4, bucket_name, pool_names.concat(cloud_pool_name), TEST_CTX.cloud_pool_name, true);
//         console.log('test test_rebuild_corrupted_from_cloud_pool successful');
//     } catch (err) {
//         console.error(`Had error in test test_rebuild_corrupted_from_cloud_pool: ${err}`);
//         throw err;

//     } finally {
//         await test_tear_down();
//     }
// }

async function main() {
    try {
        await run_test();
        process.exit(0);

    } catch (err) {
        console.warn('error while running test. ', err);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    run_test: run_test
};
