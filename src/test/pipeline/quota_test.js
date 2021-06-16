/* Copyright (C) 2016 NooBaa */
'use strict';

const api = require('../../api');
const P = require('../../util/promise');
const { S3OPS } = require('../utils/s3ops');
const Report = require('../framework/report');
const argv = require('minimist')(process.argv);
const dbg = require('../../util/debug_module')(__filename);
const { PoolFunctions } = require('../utils/pool_functions');
const { BucketFunctions } = require('../utils/bucket_functions');

const test_name = 'quota_test';
dbg.set_process_name(test_name);


const POOL_NAME = 'first-pool';
//defining the required parameters
const {
    mgmt_ip,
    mgmt_port_https,
    s3_ip,
    s3_port,
    bucket = 'first.bucket',
    data_placement = 'SPREAD',
    agents_number = 3
} = argv;

const s3ops = new S3OPS({ ip: s3_ip, port: s3_port });
//define colors
const NC = "\x1b[0m";
// const RED = "\x1b[31m";
const YELLOW = "\x1b[33;1m";

const base_unit = 1024;
const unit_mapping = {
    KB: {
        data_multiplier: base_unit ** 1,
        dataset_multiplier: base_unit ** 2
    },
    MB: {
        data_multiplier: base_unit ** 2,
        dataset_multiplier: base_unit ** 1
    },
    GB: {
        data_multiplier: base_unit ** 3,
        dataset_multiplier: base_unit ** 0
    }
};

const { data_multiplier } = unit_mapping.MB;

function usage() {
    console.log(`
    --mgmt_ip           -   noobaa management ip.
    --mgmt_port_https   -   noobaa management https port
    --s3_ip             -   noobaa s3 ip
    --s3_port           -   noobaa s3 port
    --bucket            -   bucket name (default: ${bucket})
    --data_placement    -   data placement (default ${data_placement})
    --agents_number     -   number of agents to add (default: ${agents_number})
    --help              -   show this help.
    `);
}

if (argv.help) {
    usage();
    process.exit(1);
}

const rpc = api.new_rpc_from_base_address(`wss://${mgmt_ip}:${mgmt_port_https}`, 'EXTERNAL');
const client = rpc.new_client({});

let report = new Report();

const cases = [
    'fail upload over quota',
    'upload over pool capacity'
];

report.init_reporter({
    suite: test_name,
    conf: {},
    mongo_report: true,
    cases: cases
});


const pool_functions = new PoolFunctions(client);
const bucket_functions = new BucketFunctions(client, report);

async function _upload_files(bucket_name, dataset_size, multiplier) {
    const files_list = [];
    let number_of_files = Math.floor(dataset_size / 1024); //Dividing to 1024 will get files in GB.
    if (number_of_files < 1) number_of_files = 1; //Making sure we have at list 1 file.
    const file_size = Math.floor(dataset_size / number_of_files) + 1; //Writing extra MB so we will be sure we reached max capacity.
    const parts_num = Math.floor(file_size / 100);
    const time_stamp = Math.floor(Date.now() / 1000);
    console.log(`${YELLOW}Writing ${number_of_files} files with total size: ${dataset_size + number_of_files} MB${NC}`);
    for (let count = 0; count < number_of_files; count++) {
        const file_name = `file_${count}_${file_size}_${time_stamp}`;
        files_list.push(file_name);
        console.log(`Uploading ${file_name} with size ${file_size} MB`);
        try {
            await s3ops.upload_file_with_md5(bucket_name, file_name, file_size, parts_num, multiplier);
            await P.delay(1 * 1000);
        } catch (e) {
            console.error(`${mgmt_ip} FAILED uploading files`);
            throw e;
        }
    }
    console.log(`files list is ${files_list}`);
    return files_list;
}

async function _wait_no_available_space(bucket_name) {
    const base_time = Date.now();
    let is_no_available;
    while (Date.now() - base_time < 360 * 1000) {
        try {
            is_no_available = await bucket_functions.checkAvailableSpace(bucket_name);
            if (is_no_available <= 0) {
                break;
            } else {
                await P.delay(15 * 1000);
            }
        } catch (e) {
            console.error(`Something went wrong with checkAvailableSpace`);
            throw e;
        }
    }
    if (is_no_available > 0) {
        throw new Error(`Available space should have been 0 by now`);
    }
}

async function _test_failed_upload(bucket_name, dataset_size, multiplier) {
    const file_size = Math.floor(dataset_size);
    const time_stamp = Math.floor(Date.now() / 1000);
    console.log(`Trying to upload ${dataset_size} MB after we have reached the quota`);
    const file_name = `file_over_${file_size}_${time_stamp}`;
    try {
        await s3ops.put_file_with_md5(bucket_name, file_name, file_size, multiplier);
        report.success('fail upload over quota');
    } catch (error) { //When we get to the quota, the writes should start failing
        console.log('Trying to upload pass the quota failed - as should');
        return;
    }
    report.fail('fail upload over quota');
    throw new Error(`We should have failed uploading pass the quota`);
}

async function _check_file_in_pool(file_name, pool, bucket_name) {
    let keep_run = true;
    let retry = 0;
    const MAX_RETRY = 15;
    let chunks_accessible;
    while (keep_run) {
        try {
            console.log(`Checking file ${file_name} is available and contains exactly in pool ${pool}`);
            const { chunks } = await client.object.read_object_mapping_admin({
                bucket: bucket_name,
                key: file_name,
            });
            chunks_accessible = chunks.filter(chunk => chunk.is_accessible === true);
            const chunks_accessible_length = chunks_accessible.length;
            const parts_in_pool = chunks.filter(chunk =>
                chunk.frags[0].blocks[0].adminfo.pool_name.includes(pool)).length;
            const number_of_chunks = chunks.length;
            if (chunks_accessible_length === number_of_chunks) {
                console.log(`Available chunks: ${chunks_accessible_length}/${number_of_chunks} for ${file_name}`);
            } else {
                throw new Error(`Chunks for file ${file_name} should all be in ${
                    pool}, Expected ${number_of_chunks}, received ${chunks_accessible_length}`);
            }
            if (parts_in_pool === number_of_chunks) {
                console.log(`All of the ${number_of_chunks} chunks are in ${pool}`);
            } else {
                throw new Error(`Expected ${number_of_chunks} parts in ${pool} for file ${file_name}, received ${parts_in_pool}`);
            }
            keep_run = false;
        } catch (e) {
            if (retry <= MAX_RETRY) {
                retry += 1;
                console.error(e);
                console.log(`Sleeping for 20 sec and retrying`);
                await P.delay(20 * 1000);
            } else {
                console.error(`chunks_accessible: ${chunks_accessible}`);
                throw e;
            }
        }
    }
}

async function _check_quota(bucket_name, pool, multiplier) {
    await bucket_functions.setQuotaBucket(bucket_name, 1, 'G');
    // Start writing, and see that we are failing when we get into the quota
    const uploaded_files = await _upload_files(bucket_name, 1024, multiplier);
    await _wait_no_available_space(bucket_name);
    await _test_failed_upload(bucket_name, 1024, multiplier);
    for (const file of uploaded_files) {
        await _check_file_in_pool(file, pool, bucket_name);
    }
}

async function _disable_quota_and_check(bucket_name, pool, multiplier) {
    await bucket_functions.disableQuotaBucket(bucket_name);
    await P.delay(10 * 1000); //delaying to get pool cool down
    //Continue to write and see that the writes are passing
    const uploaded_files = await _upload_files(bucket_name, 500, multiplier);
    try {
        for (const file of uploaded_files) {
            await _check_file_in_pool(file, pool, bucket_name);
            report.success('upload over pool capacity');
        }
    } catch (e) {
        report.fail('upload over pool capacity');
        throw e;
    }
}

async function main() {
    try {
        await client.create_auth_token({
            email: 'demo@noobaa.com',
            password: 'DeMo1',
            system: 'demo'
        });
        await pool_functions.create_pool(POOL_NAME, agents_number);
        await pool_functions.change_tier(POOL_NAME, bucket, data_placement);
        await _check_quota(bucket, POOL_NAME, data_multiplier);
        await _disable_quota_and_check(bucket, POOL_NAME, data_multiplier);
        console.log('quota test were successful!');
        process.exit(0);
    } catch (e) {
        console.error('something went wrong', e);
        process.exit(1);
    }
}

main();
