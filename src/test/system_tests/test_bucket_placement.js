/* Copyright (C) 2016 NooBaa */
"use strict";

const argv = require('minimist')(process.argv);
const dbg = require('../../util/debug_module')(__filename);
if (argv.log_file) {
    dbg.set_log_to_file(argv.log_file);
}
dbg.set_process_name('test_bucket_placement');

var basic_server_ops = require('../utils/basic_server_ops');
var P = require('../../util/promise');
var api = require('../../api');
var _ = require('lodash');
const test_utils = require('./test_utils');

var dotenv = require('../../util/dotenv');
dotenv.load();


const {
    mgmt_ip = 'localhost',
        mgmt_port = '8080',
        s3_ip = 'localhost',
} = argv;

argv.access_key = argv.access_key || '123';
argv.secret_key = argv.secret_key || 'abc';
var rpc = api.new_rpc();
var client = rpc.new_client({
    address: 'ws://' + mgmt_ip + ':' + mgmt_port
});

const TEST_BUCKET_NAME = 'bucket1';
const TEST_QUOTA_BUCKET_NAME = 'bucketquota';

module.exports = {
    run_test: run_test
};

// Does the Auth and returns the nodes in the system
async function create_auth() {
    var auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return client.create_auth_token(auth_params);
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
        throw new Error(`test_bucket_placement FAILED: ${err}`);
    }
}


async function upload_random_file() {
    const fkey = await basic_server_ops.generate_random_file(20);
    try {
        console.log('Uploading file ', fkey, 'to', TEST_BUCKET_NAME);
        await basic_server_ops.upload_file(s3_ip, fkey, TEST_BUCKET_NAME, fkey);
        await P.delay(3000);
        return fkey;
    } catch (err) {
        console.log('Failed uploading file', err);
        throw new Error('Failed uploading file' + err);
    }
}

async function perform_placement_tests() {
    console.log('Testing Placement');

    await create_auth();
    await Promise.all([
        test_utils.create_hosts_pool(client, 'pool1', 3),
        test_utils.create_hosts_pool(client, 'pool2', 3)
    ]);
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

    {
        const fkey = await upload_random_file();
        const { chunks } = await client.object.read_object_mapping_admin({
            bucket: TEST_BUCKET_NAME,
            key: fkey,
        });
        _.each(chunks, chunk => {
            _.each(chunk.frags, frag => {
                if (frag.blocks.length !== 3) {
                    console.error('SPREAD NOT CORRECT!');
                    throw new Error("SPREAD NOT CORRECT!");
                }
            });
        });
    }

    await client.tier.update_tier({
        name: 'tier1',
        data_placement: 'MIRROR'
    });

    {
        const fkey = await upload_random_file();
        const { chunks } = await client.object.read_object_mapping_admin({
            bucket: TEST_BUCKET_NAME,
            key: fkey,
        });
        _.each(chunks, chunk => {
            var pool1_count = 0;
            var pool2_count = 0;
            _.each(chunk.frags, frag => {
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
        await basic_server_ops.upload_file(s3_ip, fl, TEST_QUOTA_BUCKET_NAME, fl);
    } catch (err) {
        throw new Error(`perform_quota_tests should not fail ul 1mb when quota is 1gb ${err}`);
    }
    fl = await basic_server_ops.generate_random_file(1200);
    console.log('uploading 1.2GB file');
    try {
        await basic_server_ops.upload_file(s3_ip, fl, TEST_QUOTA_BUCKET_NAME, fl);
    } catch (err) {
        throw new Error(`perform_quota_tests should not fail ul 1mb when quota is 1gb ${err}`);
    }
    console.log('waiting for md_aggregation calculations');
    await P.delay(120000);
    fl = await basic_server_ops.generate_random_file(30);
    let didFail = false;
    try {
        await basic_server_ops.upload_file(s3_ip, fl, TEST_QUOTA_BUCKET_NAME, fl, 20, true);
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
            throw new Error(`Failed setting quota with ${limit_gb} - ${err}`);
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
