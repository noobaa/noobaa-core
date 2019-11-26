/* Copyright (C) 2016 NooBaa */
'use strict';

const api = require('../../api');
const { S3OPS } = require('../utils/s3ops');
const Report = require('../framework/report');
const argv = require('minimist')(process.argv);
const test_utils = require('../system_tests/test_utils');
const dbg = require('../../util/debug_module')(__filename);
const { BucketFunctions } = require('../utils/bucket_functions');

const test_name = 'reclaim';
dbg.set_process_name(test_name);

let files = [];
let errors = [];
let current_size = 0;
const POOL_NAME = "first-pool";

const {
    mgmt_ip,
    mgmt_port_https,
    s3_ip,
    s3_port,
    agent_number,
    dataset_size = 100, //MB
    max_size = 250, //MB
    min_size = 50, //MB
} = argv;

const s3ops = new S3OPS({ ip: s3_ip, port: s3_port });

function usage() {
    console.log(`
    --mgmt_ip               -   noobaa management ip.
    --mgmt_port_https       -   noobaa server management https port
    --s3_ip                 -   noobaa s3 ip
    --s3_port               -   noobaa s3 port
    --agent_number          -   number of agents to create (default: ${agent_number})
    --dataset_size          -   size uploading data for checking rebuild
    --max_size              -   max size of uploading files
    --min_size              -   min size of uploading files
    --help                  -   show this help.
    `);
}

if (argv.help) {
    usage();
    process.exit(1);
}

const rpc = api.new_rpc_from_base_address(`wss://${mgmt_ip}:${mgmt_port_https}`, 'EXTERNAL');
const client = rpc.new_client({});

let report = new Report();
//Define test cases
const cases = [
    'reclaimed blocks',
    'edit placement policy'
];
report.init_reporter({
    suite: test_name,
    conf: {
        dataset_size: dataset_size,
    },
    mongo_report: true,
    cases: cases
});

let bucket_functions = new BucketFunctions(client);

const baseUnit = 1024;
const unit_mapping = {
    KB: {
        data_multiplier: baseUnit ** 1,
        dataset_multiplier: baseUnit ** 2
    },
    MB: {
        data_multiplier: baseUnit ** 2,
        dataset_multiplier: baseUnit ** 1
    },
    GB: {
        data_multiplier: baseUnit ** 3,
        dataset_multiplier: baseUnit ** 0
    }
};

function saveErrorAndResume(message) {
    console.error(message);
    errors.push(message);
}

async function uploadAndVerifyFiles(bucket) {
    current_size = 0;
    let { data_multiplier } = unit_mapping.MB;
    console.log('Writing and deleting data till size amount to grow ' + dataset_size + ' MB');
    while (current_size < dataset_size) {
        try {
            console.log('Uploading files till data size grow to ' + dataset_size + ', current size is ' + current_size);
            let file_size = set_fileSize();
            let file_name = 'file_part_' + file_size + (Math.floor(Date.now() / 1000));
            files.push(file_name);
            current_size += file_size;
            console.log('Uploading file with size ' + file_size + ' MB');
            await s3ops.put_file_with_md5(bucket, file_name, file_size, data_multiplier);
            await s3ops.get_file_check_md5(bucket, file_name);
        } catch (err) {
            saveErrorAndResume(`${mgmt_ip} FAILED verification uploading and reading ${err}`);
            throw err;
        }
    }
}

function set_fileSize() {
    let rand_size = Math.floor((Math.random() * (max_size - min_size)) + min_size);
    if (dataset_size - current_size === 0) {
        rand_size = 1;
        //if we choose file size grater then the remaining space for the dataset,
        //set it to be in the size that complete the dataset size.
    } else if (rand_size > dataset_size - current_size) {
        rand_size = dataset_size - current_size;
    }
    return rand_size;
}

async function cleanupBucket(bucket) {
    try {
        console.log('running clean up files from bucket ' + bucket);
        await s3ops.delete_all_objects_in_bucket(bucket, true);
    } catch (err) {
        console.error(`Errors during deleting `, err);
    }
}

async function reclaimCycle(agents_num) {
    const reclaim_pool = 'reclaim.pool' + (Math.floor(Date.now() / 1000));
    const bucket = 'reclaim.bucket' + (Math.floor(Date.now() / 1000));
    try {
        await test_utils.create_hosts_pool(client, POOL_NAME, agents_num);
        await bucket_functions.createBucket(bucket);
        try {
            await bucket_functions.editBucketDataPlacement(reclaim_pool, bucket, 'SPREAD');
            report.success('edit placement policy');
        } catch (err) {
            report.fail('edit placement policy');
        }
        await uploadAndVerifyFiles(bucket);
        //TODO: stop one agent
        await cleanupBucket(bucket);
        //TODO: start the agent again.
    } catch (err) {
        report.fail('reclaimed blocks');
        throw new Error(`reclaimCycle failed: ${err}`);
    }
}

async function set_rpc_and_create_auth_token() {
    let auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return client.create_auth_token(auth_params);
}

async function main() {
    try {
        await set_rpc_and_create_auth_token();
        await reclaimCycle(agent_number);
        console.log('reclaim test was successful!');
        await report.report();
        process.exit(0);
    } catch (err) {
        await report.report();
        console.error('something went wrong' + err + errors);
        process.exit(1);
    }
}

main();
