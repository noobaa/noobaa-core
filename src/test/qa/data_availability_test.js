/* Copyright (C) 2016 NooBaa */
'use strict';

const api = require('../../api');
const { S3OPS } = require('../utils/s3ops');
const Report = require('../framework/report');
const argv = require('minimist')(process.argv);
const dbg = require('../../util/debug_module')(__filename);
const { BucketFunctions } = require('../utils/bucket_functions');
const test_utils = require('../system_tests/test_utils');
dbg.set_process_name('data_availability');


let files = [];
let errors = [];
let current_size = 0;
const POOL_NAME = "first-pool";
let failures_in_test = false;

//defining the required parameters
let {
    agents_number = 4,
} = argv;

const {
    mgmt_ip,
    mgmt_port_https,
    s3_ip,
    s3_port,
    failed_agents_number = 1,
    dataset_size = agents_number * 1024, //MB
    max_size = 250, //MB
    min_size = 50, //MB
    iterationsNumber = 9999,
    bucket = 'first.bucket',
    help = false,
    data_frags = 0,
    parity_frags = 0,
    replicas = 3,
} = argv;

const s3ops = new S3OPS({ ip: s3_ip, port: s3_port });

function usage() {
    console.log(`
    --bucket                -   bucket to run on (default: ${bucket})
    --mgmt_ip               -   noobaa management ip.
    --mgmt_port_https       -   noobaa server management https port
    --s3_ip                 -   noobaa s3 ip
    --s3_port               -   noobaa s3 port
    --agents_number         -   number of agents to add (default: ${agents_number})
    --failed_agents_number  -   number of agents to fail (default: ${failed_agents_number})
    --mgmt_ip               -   noobaa server ip.
    --dataset_size          -   size uploading data for checking rebuild
    --max_size              -   max size of uploading files
    --min_size              -   min size of uploading files
    --iterationsNumber      -   number iterations of switch off/switch on agents with checking files
    --id                    -   an id that is attached to the agents name
    --data_frags            -   erasure coding bucket configuration (default: ${data_frags})
    --parity_frags          -   erasure coding bucket configuration (default: ${parity_frags})
    --replicas              -   expected number of files replicas (default: ${replicas})
    --help                  -   show this help.
    `);
}

const test_name = 'data_availability';

if (help) {
    usage();
    process.exit(1);
}

const rpc = api.new_rpc_from_base_address(`wss://${mgmt_ip}:${mgmt_port_https}`, 'EXTERNAL');
const client = rpc.new_client({});

let report = new Report();
//Define test cases
const cases = [
    'verify file availability',
    'change tier settings'
];
report.init_reporter({
    suite: test_name,
    conf: {
        failed_agents_number: failed_agents_number,
        iterationsNumber: iterationsNumber,
        data_frags: data_frags,
        parity_frags: parity_frags,
        replicas: replicas
    },
    mongo_report: true,
    cases: cases
});

const bucket_functions = new BucketFunctions(client);

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

// console.log(`${YELLOW}resource: ${resource}, storage: ${storage}, vnet: ${vnet}${NC}`);
// const azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resource, location);


// Checking whether number of agents is enough to use erasure coding
if ((data_frags > 0) && ((data_frags + parity_frags) > agents_number)) {
    console.log('Number of agents is not enough to use erasure coding');
    agents_number = data_frags + parity_frags;
    console.log('Increasing to minimal value: ' + agents_number);
}
if ((replicas > 0) && (replicas > agents_number)) {
    console.log('Number of agents is not enough to use replicas');
    agents_number = replicas;
    console.log('Increasing to minimal value: ' + agents_number);
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

async function uploadAndVerifyFiles() {
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
            failures_in_test = true;
            throw err;
        }
    }
}

async function clean_up_dataset() {
    console.log('running clean up files from bucket ' + bucket);
    try {
        await s3ops.delete_all_objects_in_bucket(bucket, true);
    } catch (err) {
        console.error(`Errors during deleting ${err}`);
    }
}

async function stopAgentsAndCheckFiles() {
    //TODO: find a way to stop the agents, then check. 

    for (let index = 0; index < files.length; index++) {
        const file = files[index];
        try {
            await s3ops.get_file_check_md5(bucket, file);
            report.success('verify file availability');
        } catch (err) {
            saveErrorAndResume(`${mgmt_ip} FAILED read file ${err}`);
            report.fail('verify file availability');
            failures_in_test = true;
            throw err;
        }
    }
    //TODO: find a way to start the agents again. 
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
        try {
            await bucket_functions.changeTierSetting(bucket, data_frags, parity_frags, replicas);
            report.success('change tier settings');
        } catch (err) {
            report.fail('change tier settings');
        }
        await test_utils.create_hosts_pool(client, POOL_NAME, 3);
        await clean_up_dataset();
        await uploadAndVerifyFiles();
        for (let cycle = 0; cycle < iterationsNumber; cycle++) {
            console.log(`starting cycle number: ${cycle}`);
            await stopAgentsAndCheckFiles();
        }
    } catch (err) {
        console.error('something went wrong :(' + err + errors);
        failures_in_test = true;
    }
    if (failures_in_test) {
        console.error('Errors during data available test (replicas)' + errors);
        await report.report();
        process.exit(1);
    } else {
        await clean_up_dataset();
        console.log('data available test (replicas files) were successful!');
    }
    await report.report();
    process.exit(0);
}

main();
