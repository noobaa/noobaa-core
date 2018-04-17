/* Copyright (C) 2016 NooBaa */
'use strict';

const api = require('../../api');
const P = require('../../util/promise');
const s3ops = require('../utils/s3ops');
const argv = require('minimist')(process.argv);
const af = require('../utils/agent_functions');
const bf = require('../utils/bucket_functions');
const dbg = require('../../util/debug_module')(__filename);
const AzureFunctions = require('../../deploy/azureFunctions');
//const vm = require('../utils/vmware');


const test_name = 'reclaim';
dbg.set_process_name(test_name);

//define colors
const NC = "\x1b[0m";
const YELLOW = "\x1b[33;1m";

const suffixName = test_name;
const domain = process.env.DOMAIN;
const clientId = process.env.CLIENT_ID;
const secret = process.env.APPLICATION_SECRET;
const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;

let rpc;
let client;
let files = [];
let errors = [];
let current_size = 0;

const {
    location = 'westus2',
        resource, // = 'pipeline-agents',
        storage, // = 'pipelineagentsdisks',
        vnet, // = 'pipeline-agents-vnet',
        //failed_agents_number = 1,
        server_ip,
        dataset_size = 100, //MB
        max_size = 250, //MB
        min_size = 50, //MB
        id = 0,
        // use_existing_env = true
} = argv;


function usage() {
    console.log(`
    --location              -   azure location (default: ${location})
    --resource              -   azure resource group
    --storage               -   azure storage on the resource group
    --vnet                  -   azure vnet on the resource group
    --server_ip             -   noobaa server ip.
    --dataset_size          -   size uploading data for checking rebuild
    --max_size              -   max size of uploading files
    --min_size              -   min size of uploading files
    --id                    -   an id that is attached to the agents name
    --use_existing_env      -   Using existing agents and skipping agent deletion
    --help                  -   show this help.
    `);
}

const suffix = suffixName + '-' + id;

if (argv.help) {
    usage();
    process.exit(1);
}

const osesLinuxSet = [
    'ubuntu12', 'ubuntu14', 'ubuntu16',
    'centos6', 'centos7',
    'redhat6', 'redhat7'
];

const osesWinSet = [
    'win2008', 'win2012', 'win2016'
];

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
            await s3ops.put_file_with_md5(server_ip, bucket, file_name, file_size, data_multiplier);
            await s3ops.get_file_check_md5(server_ip, bucket, file_name);
        } catch (err) {
            saveErrorAndResume(`${server_ip} FAILED verification uploading and reading `, err);
            throw err;
        }
    }
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

async function createReclaimPool(reclaim_pool, agentSuffix) {
    let list = [];
    const host_list = await client.host.list_hosts({});
    const hosts = host_list.hosts;
    for (const host of hosts) {
        if ((host.mode === 'OPTIMAL') && (host.name.includes(agentSuffix))) {
            list.push(host.name);
        }
    }
    console.log('Creating pool with online agents: ' + list);
    try {
        await client.pool.create_hosts_pool({
            name: reclaim_pool,
            hosts: list
        });
    } catch (error) {
        saveErrorAndResume('Failed create pool ' + reclaim_pool + error);
    }
}

async function cleanupBucket(bucket) {
    try {
        console.log('runing clean up files from bucket ' + bucket);
        const file_list = await s3ops.get_list_files(server_ip, bucket, '');
        await s3ops.delete_folder(server_ip, bucket, ...file_list);
    } catch (err) {
        console.error(`Errors during deleting `, err);
    }
}

console.log(`${YELLOW}resource: ${resource}, storage: ${storage}, vnet: ${vnet}${NC}`);
const azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resource, location);

async function reclaimCycle(oses, prefix) {
    let agentSuffix = prefix + suffix;
    let reclaim_pool = prefix + 'reclaim.pool' + (Math.floor(Date.now() / 1000));
    let bucket = prefix + 'reclaim.bucket' + (Math.floor(Date.now() / 1000));
    try {
        const agents = await af.createRandomAgents(azf, server_ip, storage, vnet, oses.length, agentSuffix, oses);
        const agentList = Array.from(agents.keys());
        await bf.createBucket(server_ip, bucket);
        await createReclaimPool(reclaim_pool, agentSuffix);
        await bf.editBucketDataPlacement(reclaim_pool, bucket, server_ip);
        await uploadAndVerifyFiles(bucket);
        const stoppedAgent = await af.stopRandomAgents(azf, server_ip, 1, agentSuffix, agentList);
        await cleanupBucket(bucket);
        await af.startOfflineAgents(azf, server_ip, agentSuffix, stoppedAgent);
        await s3ops.get_list_files(server_ip, bucket, '');
    } catch (err) {
        throw new Error(`reclaimCycle failed: ${err}`);
    }
}

async function set_rpc_and_create_auth_token() {
    rpc = api.new_rpc('wss://' + server_ip + ':8443');
    client = rpc.new_client({});
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
        await P.join(reclaimCycle(osesWinSet, 'win'), reclaimCycle(osesLinuxSet, 'linux'));
        //.then(() => reclaimCycle(osesWinSet))
        //.then(() => af.createRandomAgents(azf, server_ip, storage, vnet, osesWinSet.length, suffix, osesWinSet))
        await af.clean_agents(azf, server_ip, suffix);
        console.log('reclaim test was successful!');
        process.exit(0);
    } catch (err) {
        console.error('something went wrong' + err + errors);
        process.exit(1);
    }
}

return run_main();
