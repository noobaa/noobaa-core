/* Copyright (C) 2016 NooBaa */
'use strict';

const argv = require('minimist')(process.argv);
const AzureFunctions = require('../../deploy/azureFunctions');
const P = require('../../util/promise');
const promise_utils = require('../../util/promise_utils');
const s3ops = require('../qa/s3ops');
const af = require('../qa/functions/agent_functions');
const api = require('../../api');

require('../../util/dotenv').load();

//define colors
const YELLOW = "\x1b[33;1m";
const NC = "\x1b[0m";

const clientId = process.env.CLIENT_ID;
const domain = process.env.DOMAIN;
const secret = process.env.APPLICATION_SECRET;
const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
const suffix = 'replica';
let stopped_oses = [];
let failures_in_test = false;
let errors = [];
let files = [];
let oses = [];

//defining the required parameters
const {
    location = 'westus2',
    resource, // = 'pipeline-agents',
    storage, // = 'pipelineagentsdisks',
    vnet, // = 'pipeline-agents-vnet',
    agents_number = 5,
    failed_agents_number = 1,
    server_ip,
    bucket = 'first.bucket',
    help = false
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
    --help                  -   show this help.
    `);
}

if (help) {
    usage();
    process.exit(1);
}

let osesSet = [
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

function uploadAndVerifyFiles(dataset_size_GB) {
    let { data_multiplier } = unit_mapping.MB;
    let dataset_size = dataset_size_GB * 1024;
    let parts = 20;
    let partSize = dataset_size / parts;
    let file_size = Math.floor(partSize);
    let part = 0;
    console.log('Writing and deleting data till size amount to grow ' + dataset_size_GB + ' GB');
    return promise_utils.pwhile(() => part < parts, () => {
        let file_name = 'file_part_' + part + file_size + (Math.floor(Date.now() / 1000));
        files.push(file_name);
        console.log('files list is ' + files);
        part += 1;
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

function getRebuildReplicasStatus(key) {
    let result = false;
    let replicaStatusOnline = [];
    let replicas = [];
    let fileParts = [];
    const rpc = api.new_rpc_default_only('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    let auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return client.create_auth_token(auth_params)
        .then(() => P.resolve(client.object.read_object_mappings({
            bucket,
            key,
            adminfo: true
        })))
        .then(res => {
            fileParts = res.parts;
            return P.each(fileParts, part => replicas.push(part.chunk.frags[0].blocks));
        })
        .then(() => {
                for (let i = 0; i < replicas.length; i++) {
                        replicaStatusOnline = replicas[i].filter(replica => replica.adminfo.online === true);
                        if (replicaStatusOnline.length === 3) {
                            console.log('Part ' + i + ' contains 3 online replicas - as should');
                            result = true;
                        } else {
                            console.warn('Parts contain online replicas ' + replicaStatusOnline.length);
                            result = false;
                        }
                    }
                })
        .catch(err => console.warn('Check rebuild replicas with error ' + err))
        .then(() => result);
}

function waitForRebuildObjects(file) {
    let retries = 0;
    let rebuild = false;
    console.log('Waiting for rebuild object ' + file);
    return promise_utils.pwhile(
        () => rebuild === false && retries !== 36,
        () => P.resolve(getRebuildReplicasStatus(file))
            .then(res => {
                if (res) {
                    rebuild = res;
                } else {
                    retries += 1;
                    console.log('Waiting for rebuild object ' + file + ' - will wait for extra 5 seconds retries ' + retries);
                }
            })
            .catch(e => console.warn('Waiting for rebuild file ' + file + 'with error ' + e))
            .delay(5000));
}

function clean_up_dataset() {
    console.log('runing clean up files from bucket ' + bucket);
    return s3ops.get_list_files(server_ip, bucket, '')
        .then(res => s3ops.delete_folder(server_ip, bucket, ...res))
        .catch(err => console.error(`Errors during deleting `, err));
}

return azf.authenticate()
    .then(() => af.createRandomAgents(azf, server_ip, storage, vnet, agents_number, suffix, osesSet))
    .then(res => {
        oses = res;
        //Create a dataset on it (1 GB per agent)
        return uploadAndVerifyFiles(agents_number);
    })
    //Power down agents (random number between 1 to the max amount)
    .then(() => af.stopRandomAgents(azf, server_ip, failed_agents_number, suffix, oses))
    .then(res => {
        stopped_oses = res;
        //waiting for rebuild files by chunks and parts
        return P.each(files, file => waitForRebuildObjects(file));
    })
    //Read and verify the read
    .then(() => P.each(files, file => getRebuildReplicasStatus(file)
        .then(res => {
            if (res === true) {
                console.log('File ' + file + ' rebuild successfully');
            } else {
                saveErrorAndResume('File ' + file + ' didn\'t rebuild');
            }
        })))
    .then(readFiles)
    //Power on the powered off agents and wait for them to be on
    .then(() => af.startOfflineAgents(azf, server_ip, suffix, stopped_oses))
    //Power down agents (random number between 1 to the max amount)
    .then(() => af.stopRandomAgents(azf, server_ip, failed_agents_number, suffix, oses))
    .then(res => {
        stopped_oses = res;
        //waiting for rebuild files by chunks and parts
        return P.each(files, file => waitForRebuildObjects(file));
    })
    //Read and verify the read
    .then(() => P.each(files, file => getRebuildReplicasStatus(file)
        .then(res => {
            if (res === true) {
                console.log('File ' + file + ' rebuild successfully');
            } else {
                saveErrorAndResume('File ' + file + ' didn\'t rebuild');
            }
        })))
    .then(readFiles)
    .catch(err => {
        console.error('something went wrong :(' + err + errors);
        failures_in_test = true;
    })
    .finally(() => af.clean_agents(azf, oses, suffix)
        .then(clean_up_dataset))
    .then(() => {
        if (failures_in_test) {
            console.error(':( :( Errors during rebuild replicas parts test (replicas) ): ):' + errors);
            process.exit(1);
        }
        console.log(':) :) :) rebuild replicas parts test (replicas) were successful! (: (: (:');
        process.exit(0);
    });
