/* Copyright (C) 2016 NooBaa */
"use strict";

var basic_server_ops = require('../utils/basic_server_ops');
// var config = require('../../../config');
var P = require('../../util/promise');
var api = require('../../api');
var argv = require('minimist')(process.argv);
var _ = require('lodash');
var dotenv = require('../../util/dotenv');
// var promise_utils = require('../../util/promise_utils');
dotenv.load();

argv.ip = argv.ip || '127.0.0.1';
argv.access_key = argv.access_key || '123';
argv.secret_key = argv.secret_key || 'abc';
var rpc = api.new_rpc();
var client = rpc.new_client({
    address: 'ws://' + argv.ip + ':' + process.env.PORT
});

// let internal_pool;

const TEST_BUCKET_NAME = 'bucket1';
const TEST_QUOTA_BUCKET_NAME = 'bucketquota';

module.exports = {
    run_test: run_test
};

// Does the Auth and returns the nodes in the system
function get_hosts_auth() {
    var auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return P.fcall(function() {
            return client.create_auth_token(auth_params);
        })
        .then(() => client.system.read_system())
        .then(function(system) {
            //internal_pool = _.find(system.pools, pool => pool.name.includes(config.INTERNAL_STORAGE_POOL_NAME)).name;
            return client.host.list_hosts({
                query: {
                    mode: ['OPTIMAL'],
                    pools: ['first.pool']
                }
            });
        });
}

async function run_test() {
    try {
        await perform_placement_tests();
        await perform_quota_tests();
        rpc.disconnect_all();
        return P.resolve("Test Passed! Everything Seems To Be Fine...");
    } catch (err) {
        console.error('test_bucket_placement FAILED: ', err.stack || err);
        rpc.disconnect_all();
        throw new Error('test_bucket_placement FAILED: ', err);
    }
}

async function perform_placement_tests() {
    console.log('Testing Placement');
    // Used in order to get the nodes of the system
    var sys_hosts;
    // Used in order to get the key of the file
    var fkey = null;


    sys_hosts = await get_hosts_auth();
    if (sys_hosts.total_count < 6) {
        return P.reject("Not Enough Nodes For 2 Pools");
    }
    await client.pool.create_hosts_pool({
        name: "pool1",
        hosts: sys_hosts.hosts.map(host => host.name).slice(0, 3)
    });
    await client.pool.create_hosts_pool({
        name: "pool2",
        hosts: sys_hosts.hosts.map(host => host.name).slice(3, 6)
    });
    await client.tier.create_tier({
        name: 'tier1',
        attached_pools: ['pool1', 'pool2'],
        data_placement: 'SPREAD'
    });
    await client.tiering_policy.create_policy({
        name: 'tiering1',
        tiers: [{
            order: 0,
            tier: 'tier1',
            spillover: false,
            disabled: false
        }]
    });
    await client.bucket.create_bucket({
        name: TEST_BUCKET_NAME,
        tiering: 'tiering1',
    });
    fkey = await basic_server_ops.generate_random_file(20);
    try {
        await basic_server_ops.upload_file(argv.ip, fkey, TEST_BUCKET_NAME, fkey);
    } catch (err) {
        console.log('Failed uploading file (SPREAD)', err);
        throw new Error('Failed uploading file (SPREAD) ' + err);
    }
    await P.delay(3000);
    let mappings = await client.object.read_object_mappings({
        bucket: TEST_BUCKET_NAME,
        key: fkey,
        adminfo: true
    });
    _.each(mappings.parts, part => {
        _.each(part.chunk.frags, frag => {
            if (frag.blocks.length !== 3) {
                console.error('SPREAD NOT CORRECT!');
                throw new Error("SPREAD NOT CORRECT!");
            }
        });
    });
    await client.tier.update_tier({
        name: 'tier1',
        data_placement: 'MIRROR'
    });
    fkey = await basic_server_ops.generate_random_file(20);
    try {
        await basic_server_ops.upload_file(argv.ip, fkey, TEST_BUCKET_NAME, fkey);
    } catch (err) {
        console.log('Failed uploading file (MIRROR)', err);
        throw new Error('Failed uploading file (MIRROR) ' + err);
    }
    await P.delay(3000);
    mappings = await client.object.read_object_mappings({
        bucket: TEST_BUCKET_NAME,
        key: fkey,
        adminfo: true
    });
    _.each(mappings.parts, part => {
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
            console.error('MIRROR NOT CORRECT!');
            throw new Error("MIRROR NOT CORRECT!");
        }
    });
}

async function perform_quota_tests() {
    console.log('Testing Quota');
    await client.tier.create_tier({
        name: 'tier2',
        attached_pools: ['pool1', 'pool2'],
        data_placement: 'SPREAD'
    });
    await client.tiering_policy.create_policy({
        name: 'tiering2',
        tiers: [{
            order: 0,
            tier: 'tier2',
            spillover: false,
            disabled: false
        }]
    });
    await client.bucket.create_bucket({
        name: TEST_QUOTA_BUCKET_NAME,
        tiering: 'tiering2',
    });
    await update_quota_on_bucket(1);
    console.log(`Bucket ${TEST_QUOTA_BUCKET_NAME} quota was set to 1GB`);
    let fl = await basic_server_ops.generate_random_file(1);
    console.log('Uploading 1MB file');
    try {
        await basic_server_ops.upload_file(argv.ip, fl, TEST_QUOTA_BUCKET_NAME, fl);
    } catch (err) {
        throw new Error('perform_quota_tests should not fail ul 1mb when quota is 1gb', err);
    }
    fl = await basic_server_ops.generate_random_file(1200);
    console.log('uploading 1.2GB file');
    try {
        await basic_server_ops.upload_file(argv.ip, fl, TEST_QUOTA_BUCKET_NAME, fl);
    } catch (err) {
        throw new Error('perform_quota_tests should not fail ul 1mb when quota is 1gb', err);
    }
    console.log('waiting for md_aggregation calculations');
    await P.delay(120000);
    fl = await basic_server_ops.generate_random_file(30);
    let didFail = false;
    try {
        await basic_server_ops.upload_file(argv.ip, fl, TEST_QUOTA_BUCKET_NAME, fl, 20, true);
    } catch (err) {
        didFail = true;
        console.info('Expected failure of file over quota limit');
    }
    if (!didFail) throw new Error('Upload Should not succeed when over quota');
    await update_quota_on_bucket();
}

function update_quota_on_bucket(limit_gb) {
    return P.resolve()
        .then(() => {
            if (limit_gb) {
                return client.bucket.update_bucket({
                    name: TEST_QUOTA_BUCKET_NAME,
                    quota: {
                        size: limit_gb,
                        unit: 'GIGABYTE'
                    }
                });
            } else {
                return client.bucket.update_bucket({
                    name: TEST_QUOTA_BUCKET_NAME,
                });
            }
        })
        .catch(err => {
            throw new Error(`Failed setting quota with ${limit_gb}`, err);
        });
}

// function perform_spillover_tests(fkey) {
//     console.log('Testing spillover');
//     return P.each([{
//                 pool_name: internal_pool,
//                 replicas: 1
//             }, {
//                 pool_name: 'pool2',
//                 replicas: 3
//             }], spillover_pool => P.resolve()
//             .then(() => console.log('updating bucket to spillover only - pool', spillover_pool.pool_name))
//             .then(() => update_bucket_policy_to_spillover_only(spillover_pool.pool_name))
//             .then(() => console.log('making sure file in on spillover only - pool', spillover_pool.pool_name))
//             .then(() => check_file_validity_on_pool(fkey, spillover_pool.pool_name, spillover_pool.replicas)) // only on spillover pool
//             .then(() => console.log('updating bucket to pool1 with spillover on pool', spillover_pool.pool_name))
//             .then(() => update_bucket_policy_to_with_spillover(spillover_pool.pool_name))
//             .then(() => console.log('making sure file in on pool1 only - spillback'))
//             .then(() => check_file_validity_on_pool(fkey, 'pool1', 3)) // only on pool  - spillback
//         )
//         .then(() => update_bucket_policy_to_spillover_only(internal_pool))
//         .then(() => perform_upload_test_without_spillover());
// }

// function update_bucket_policy_to_with_spillover(pool) {
//     return P.resolve()
//         .then(() => client.tier.update_tier({
//             name: 'tier1',
//             attached_pools: ['pool1'],
//             data_placement: 'SPREAD'
//         }))
//         .then(() => client.bucket.update_bucket({
//             name: TEST_BUCKET_NAME,
//             tiering: 'tiering1',
//             spillover: pool
//         }));
// }

// function update_bucket_policy_to_spillover_only(pool) {
//     return P.resolve()
//         .then(() => client.tier.update_tier({
//             name: 'tier1',
//             attached_pools: [],
//             data_placement: 'SPREAD'
//         }))
//         .then(() => client.bucket.update_bucket({
//             name: TEST_BUCKET_NAME,
//             tiering: 'tiering1',
//             spillover: pool
//         }));
// }

// function check_file_validity_on_pool(fkey, pool, replicas) {
//     let abort_timeout_sec = 3 * 60;
//     let first_iteration = true;
//     let blocks_correct = false;
//     let start_ts;

//     return promise_utils.pwhile(
//         function() {
//             return !blocks_correct;
//         },
//         function() {
//             blocks_correct = true;
//             let not_in_correct_pool_error = false;
//             let replicas_not_correct_number = 0;
//             return client.object.read_object_mappings({
//                     bucket: TEST_BUCKET_NAME,
//                     key: fkey,
//                     adminfo: true
//                 })
//                 .then(res => {
//                     _.each(res.parts, part => {
//                         let blocks_per_chunk_count = 0;
//                         _.each(part.chunk.frags, frag => {
//                             _.each(frag.blocks, block => {
//                                 blocks_per_chunk_count += 1;
//                                 if (!(block.adminfo.pool_name === pool)) {
//                                     blocks_correct = false;
//                                     not_in_correct_pool_error = true;
//                                 }
//                             });
//                         });
//                         if (blocks_per_chunk_count !== replicas) {
//                             blocks_correct = false;
//                             replicas_not_correct_number = blocks_per_chunk_count;
//                         }
//                     });
//                     if (blocks_correct) {
//                         console.log('check_file_validity_on_spillover PASSED!');
//                     } else {
//                         if (first_iteration) {
//                             start_ts = Date.now();
//                             first_iteration = false;
//                         }

//                         let diff = Date.now() - start_ts;
//                         if (diff > abort_timeout_sec * 1000) {
//                             console.error('Failed check_file_validity_on_spillover!!! aborting after ' + abort_timeout_sec + ' seconds');
//                             if (not_in_correct_pool_error) {
//                                 console.error("check_file_validity_on_spillover BLOCK NOT IN SPILLOVER POOL");
//                             }
//                             if (replicas_not_correct_number) {
//                                 console.error("check_file_validity_on_spillover REPLICAS ON SPILLOVER NOT CORRECT!", replicas_not_correct_number);
//                             }
//                             throw new Error('aborted check_file_validity_on_spillover after ' + abort_timeout_sec + ' seconds');
//                         }
//                         return P.delay(500);
//                     }
//                 })
//                 .delay(1000);
//         });
// }


// function perform_upload_test_without_spillover() {
//     let catch_received = false;
//     const err_timeout = new Error('TIMED OUT FROM PROMISE');
//     return P.resolve()
//         .then(() => client.bucket.update_bucket({
//             name: TEST_BUCKET_NAME,
//             tiering: 'tiering1',
//             spillover: null
//         }))
//         .then(() => basic_server_ops.generate_random_file(1))
//         .then(fl => basic_server_ops.upload_file(argv.ip, fl, TEST_BUCKET_NAME, fl)
//             // Since upload_file has a timeout of 20minutes, we do not want to wait
//             // Please fix this value in case that you change put_object in ec2_wrapper
//             // We currently use 10 seconds since it is the cycle length there to retry
//             .timeout(10000, err_timeout)
//             .catch(err => {
//                 if (err === err_timeout) {
//                     console.log('DESIRED ERROR - ', err.message);
//                     catch_received = true;
//                 } else {
//                     console.warn('UNDESIRED ERROR - ', err);
//                 }
//             })
//             .then(() => {
//                 if (!catch_received) {
//                     console.error('SHOULD NOT SUCCEED TO UPLOAD');
//                     throw new Error('SHOULD NOT SUCCEED TO UPLOAD');
//                 }
//             }));
// }

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
