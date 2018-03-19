/* Copyright (C) 2016 NooBaa */
'use strict';

const argv = require('minimist')(process.argv);
const AzureFunctions = require('../../deploy/azureFunctions');
const P = require('../../util/promise');
const promise_utils = require('../../util/promise_utils');
const s3ops = require('../utils/s3ops');
const af = require('../utils/agent_functions');
const bf = require('../utils/bucket_functions');
const dbg = require('../../util/debug_module')(__filename);
dbg.set_process_name('data_avilability');

//define colors
const YELLOW = "\x1b[33;1m";
const NC = "\x1b[0m";

const clientId = process.env.CLIENT_ID;
const domain = process.env.DOMAIN;
const secret = process.env.APPLICATION_SECRET;
const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
let suffix = 'erasure';
let stopped_oses = [];
let failures_in_test = false;
let errors = [];
let files = [];
let current_size = 0;

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
        id,
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

if (process.id !== undefined) {
    suffix = suffix + '-' + id;
}

if (help) {
    usage();
    process.exit(1);
}

const osesSet = [
    'ubuntu12', 'ubuntu14', 'ubuntu16',
    'centos6', 'centos7',
    'redhat6', 'redhat7',
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

function uploadAndVerifyFiles() {
    let { data_multiplier } = unit_mapping.MB;
    console.log('Writing and deleting data till size amount to grow ' + dataset_size + ' MB');
    return promise_utils.pwhile(() => current_size < dataset_size, () => {
            console.log('Uploading files till data size grow to ' + dataset_size + ', current size is ' + current_size);
            let file_size = set_fileSize();
            let file_name = 'file_part_' + file_size + (Math.floor(Date.now() / 1000));
            files.push(file_name);
            current_size += file_size;
            console.log('Uploading file with size ' + file_size + ' MB');
            return s3ops.put_file_with_md5(server_ip, bucket, file_name, file_size, data_multiplier)
                .then(() => s3ops.get_file_check_md5(server_ip, bucket, file_name));
        })
        .catch(err => {
            saveErrorAndResume(`${server_ip} FAILED verification uploading and reading `, err);
            failures_in_test = true;
            throw err;
        });
}

function readFiles() {
    return P.each(files, file => s3ops.get_file_check_md5(server_ip, bucket, file))
        .catch(err => {
            saveErrorAndResume(`${server_ip} FAILED read file`, err);
            failures_in_test = true;
            throw err;
        });
}

function clean_up_dataset() {
    console.log('runing clean up files from bucket ' + bucket);
    return s3ops.get_list_files(server_ip, bucket, '')
        .then(res => s3ops.delete_folder(server_ip, bucket, ...res))
        .catch(err => console.error(`Errors during deleting `, err));
}

function stopAgentsAndCheckFiles() {
    //Power down agents (random number between 1 to the max amount)
    stopped_oses = [];
    return af.getTestNodes(server_ip, suffix)
        .then(res => af.stopRandomAgents(azf, server_ip, failed_agents_number, '', res))
        .then(res => {
            stopped_oses = res;
            return readFiles();
        });
}

return azf.authenticate()
    .then(() => bf.changeTierSetting(server_ip, bucket, data_frags, parity_frags, replicas))
    .then(() => af.getTestNodes(server_ip, suffix))
    .then(res => {
        if ((use_existing_env) && (res)) {
            let agents = new Map();
            let createdAgents = af.getRandomOsesFromList(agents_number, osesSet);
            for (let i = 0; i < createdAgents.length; i++) {
                agents.set(suffix + i, createdAgents[i]);
            }
            for (let i = 0; i < res.length; i++) {
                if (agents.has(res[i])) {
                    agents.delete(res[i]);
                }
            }
            return af.createAgentsFromMap(azf, server_ip, storage, vnet, [], agents);
        } else {
            return af.clean_agents(azf, server_ip, suffix)
                .then(() => af.createRandomAgents(azf, server_ip, storage, vnet, agents_number, suffix, osesSet));
        }
    })
    .then(clean_up_dataset)
    .then(() => uploadAndVerifyFiles())
    .then(() => promise_utils.loop(iterationsNumber, cycle => {
        console.log(`starting cycle number: ${cycle}`);
        return stopAgentsAndCheckFiles()
            .then(() => af.startOfflineAgents(azf, server_ip, '', stopped_oses));
    }))
    .catch(err => {
        console.error('something went wrong :(' + err + errors);
        failures_in_test = true;
    })
    .then(() => {
        if (failures_in_test) {
            console.error(':( :( Errors during data available test (replicas) ): ):' + errors);
            process.exit(1);
        } else if (use_existing_env) {
            return clean_up_dataset()
                .then(() => {
                    console.log(':) :) :) data available test (replicas files) were successful! (: (: (:');
                    process.exit(0);
                });
        } else {
            return af.clean_agents(azf, server_ip, suffix)
                .then(clean_up_dataset)
                .then(() => {
                    console.log(':) :) :) data available test (replicas files) were successful! (: (: (:');
                    process.exit(0);
                });
        }
    });
