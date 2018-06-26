/* Copyright (C) 2016 NooBaa */
'use strict';

const api = require('../../api');
const { S3OPS } = require('../utils/s3ops');
const Report = require('../framework/report');
const argv = require('minimist')(process.argv);
const af = require('../utils/agent_functions');
const dbg = require('../../util/debug_module')(__filename);
const AzureFunctions = require('../../deploy/azureFunctions');
const { BucketFunctions } = require('../utils/bucket_functions');
dbg.set_process_name('data_avilability');

//define colors
const NC = "\x1b[0m";
const YELLOW = "\x1b[33;1m";

let files = [];
let errors = [];
let current_size = 0;
let stopped_oses = [];
const suffixName = 'da';
const s3ops = new S3OPS();
let failures_in_test = false;
const domain = process.env.DOMAIN;
const clientId = process.env.CLIENT_ID;
const secret = process.env.APPLICATION_SECRET;
const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;

//defining the required parameters
let {
    agents_number = 4,
} = argv;

const {
    location = 'westus2',
        resource, // = 'pipeline-agents',
        storage, // = 'pipelineagentsdisks',
        vnet, // = 'pipeline-agents-vnet',
        failed_agents_number = 1,
        server_ip,
        dataset_size = agents_number * 1024, //MB
        max_size = 250, //MB
        min_size = 50, //MB
        iterationsNumber = 9999,
        bucket = 'first.bucket',
        id = 0,
        help = false,
        data_frags = 0,
        parity_frags = 0,
        replicas = 3,
        use_existing_env = true
} = argv;


function usage() {
    console.log(`
    --location              -   azure location (default: ${location})
    --bucket                -   bucket to run on (default: ${bucket})
    --resource              -   azure resource group
    --storage               -   azure storage on the resource group
    --vnet                  -   azure vnet on the resource group
    --agents_number         -   number of agents to add (default: ${agents_number})
    --failed_agents_number  -   number of agents to fail (default: ${failed_agents_number})
    --server_ip             -   noobaa server ip.
    --dataset_size          -   size uploading data for checking rebuild
    --max_size              -   max size of uploading files
    --min_size              -   min size of uploading files
    --iterationsNumber      -   number iterations of switch off/switch on agents with checking files
    --id                    -   an id that is attached to the agents name
    --use_existing_env      -   Using existing agents and skipping agent deletion
    --data_frags            -   erasure coding bucket configuration (default: ${data_frags})
    --parity_frags          -   erasure coding bucket configuration (default: ${parity_frags})
    --replicas              -   expected number of files replicas (default: ${replicas})
    --help                  -   show this help.
    `);
}

const suffix = suffixName + '-' + id;

if (help) {
    usage();
    process.exit(1);
}

const rpc = api.new_rpc('wss://' + server_ip + ':8443');
const client = rpc.new_client({});

let report = new Report();
let bf = new BucketFunctions(client, report);

const osesSet = af.supported_oses();


const baseUnit = 1024;
const unit_mapping = {
    KB: {
        data_multiplier: Math.pow(baseUnit, 1),
        dataset_multiplier: Math.pow(baseUnit, 2)
    },
    MB: {
        data_multiplier: Math.pow(baseUnit, 2),
        dataset_multiplier: Math.pow(baseUnit, 1)
    },
    GB: {
        data_multiplier: Math.pow(baseUnit, 3),
        dataset_multiplier: Math.pow(baseUnit, 0)
    }
};

function saveErrorAndResume(message) {
    console.error(message);
    errors.push(message);
}

console.log(`${YELLOW}resource: ${resource}, storage: ${storage}, vnet: ${vnet}${NC}`);
const azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resource, location);


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
        //set it to be in the size that complet the dataset size.
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
            await s3ops.put_file_with_md5(server_ip, bucket, file_name, file_size, data_multiplier);
            await s3ops.get_file_check_md5(server_ip, bucket, file_name);
        } catch (err) {
            saveErrorAndResume(`${server_ip} FAILED verification uploading and reading `, err);
            failures_in_test = true;
            throw err;
        }
    }
}

async function readFiles() {
    for (let index = 0; index < files.length; index++) {
        const file = files[index];
        try {
            await s3ops.get_file_check_md5(server_ip, bucket, file);
        } catch (err) {
            saveErrorAndResume(`${server_ip} FAILED read file`, err);
            failures_in_test = true;
            throw err;
        }
    }
}

async function clean_up_dataset() {
    console.log('runing clean up files from bucket ' + bucket);
    try {
        const file_list = await s3ops.get_list_files(server_ip, bucket, '');
        await s3ops.delete_folder(server_ip, bucket, ...file_list);
    } catch (err) {
        console.error(`Errors during deleting `, err);
    }
}

async function stopAgentsAndCheckFiles() {
    //Power down agents (random number between 1 to the max amount)
    const test_nodes = await af.getTestNodes(server_ip, suffix);
    stopped_oses = await af.stopRandomAgents(azf, server_ip, failed_agents_number, '', test_nodes);
    return readFiles();
}

async function set_rpc_and_create_auth_token() {
    let auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return client.create_auth_token(auth_params);
}

async function run_main() {
    try {
        await azf.authenticate();
        await set_rpc_and_create_auth_token();
        await bf.changeTierSetting(bucket, data_frags, parity_frags, replicas);
        const test_nodes = await af.getTestNodes(server_ip, suffix);
        if ((use_existing_env) && (test_nodes)) {
            let agents = new Map();
            let createdAgents = af.getRandomOsesFromList(agents_number, osesSet);
            for (let i = 0; i < createdAgents.length; i++) {
                agents.set(suffix + i, createdAgents[i]);
            }
            for (let i = 0; i < test_nodes.length; i++) {
                if (agents.has(test_nodes[i])) {
                    agents.delete(test_nodes[i]);
                }
            }
            await af.createAgentsFromMap(azf, server_ip, storage, vnet, [], agents);
        } else {
            await af.clean_agents(azf, server_ip, suffix);
            await af.createRandomAgents(azf, server_ip, storage, vnet, agents_number, suffix, osesSet);
        }
        await clean_up_dataset();
        await uploadAndVerifyFiles();
        for (let cycle = 0; cycle < iterationsNumber; cycle++) {
            console.log(`starting cycle number: ${cycle}`);
            await stopAgentsAndCheckFiles();
            await af.startOfflineAgents(azf, server_ip, '', stopped_oses);
        }
    } catch (err) {
        console.error('something went wrong :(' + err + errors);
        failures_in_test = true;
    }
    if (failures_in_test) {
        console.error('Errors during data available test (replicas)' + errors);
        await report.print_report();
        process.exit(1);
    } else if (use_existing_env) {
        await clean_up_dataset();
        console.log('data available test (replicas files) were successful!');
    } else {
        await af.clean_agents(azf, server_ip, suffix);
        await clean_up_dataset();
        console.log('data available test (replicas files) were successful!');
    }
    await report.print_report();
    process.exit(0);
}

run_main();
