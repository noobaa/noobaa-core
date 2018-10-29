/* Copyright (C) 2016 NooBaa */
'use strict';

const api = require('../../api');
const P = require('../../util/promise');
const { S3OPS } = require('../utils/s3ops');
const Report = require('../framework/report');
const af = require('../utils/agent_functions');
const argv = require('minimist')(process.argv);
const dbg = require('../../util/debug_module')(__filename);
const AzureFunctions = require('../../deploy/azureFunctions');
const { BucketFunctions } = require('../utils/bucket_functions');
dbg.set_process_name('rebuild_replicas');

//define colors
const YELLOW = "\x1b[33;1m";
const NC = "\x1b[0m";

const clientId = process.env.CLIENT_ID;
const domain = process.env.DOMAIN;
const secret = process.env.APPLICATION_SECRET;
const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
const suffixName = 'replica';
let stopped_oses = [];
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
        help = false,
        id = 0,
        data_frags = 0,
        parity_frags = 0,
        replicas = 3,
        iterations_number = 2
} = argv;

const s3ops = new S3OPS({ ip: server_ip });
const test_name = 'rebuild_replica';

function usage() {
    console.log(`
    --location              -   azure location (default: ${location})
    --bucket                -   bucket to run on (default: ${bucket})
    --data_frags            -   bucket configuration (default: ${data_frags})
    --parity_frags          -   bucket configuration (default: ${parity_frags})
    --replicas              -   expected number of files replicas (default: ${replicas})
    --resource              -   azure resource group
    --storage               -   azure storage on the resource group
    --vnet                  -   azure vnet on the resource group
    --agents_number         -   number of agents to add (default: ${agents_number})
    --failed_agents_number  -   number of agents to fail (default: ${failed_agents_number})
    --iterations_number     -   number circles with stopping and running agents (default: ${iterations_number})
    --id                    -   an id that is attached to the agents name
    --server_ip             -   noobaa server ip.
    --help                  -   show this help.
    `);
}

if (help) {
    usage();
    process.exit(1);
}

const rpc = api.new_rpc('wss://' + server_ip + ':8443');
const client = rpc.new_client({});

let report = new Report();
//Define test cases
const cases = [
    'correct num replicas after node failure',
    'chunk healthy'
];
report.init_reporter({
    suite: test_name,
    conf: {
        failed_agents_number: failed_agents_number,
        iterations_number: iterations_number,
        data_frags: data_frags,
        parity_frags: parity_frags,
        replicas: replicas
    },
    mongo_report: true,
    cases: cases
});

let bf = new BucketFunctions(client);

const suffix = suffixName + '-' + id;

if ((data_frags && !parity_frags) || (!data_frags && parity_frags)) {
    throw new Error('Set both data_frags and parity_frags to use erasure coding ');
}
if (data_frags && parity_frags && !replicas) {
    console.log('Using erasure coding with data_frags = ' + data_frags + ' and parity frags = ' + parity_frags);
}
if (!data_frags && !parity_frags && replicas) {
    console.log('Using replicas number = ' + replicas);
}

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

async function uploadAndVerifyFiles(num_agents) {
    let { data_multiplier } = unit_mapping.MB;
    // 1/2 GB per agent. 1 GB seems like too much memory for the lg to handle
    let dataset_size = num_agents * 128;
    let parts = 20;
    let partSize = dataset_size / parts;
    let file_size = Math.floor(partSize);
    let part = 0;
    console.log('Writing and deleting data till size amount to grow ' + num_agents + ' GB');
    try {
        while (part < parts) {
            let file_name = 'file_part_' + part + file_size + (Math.floor(Date.now() / 1000));
            files.push(file_name);
            console.log('files list is ' + files);
            part += 1;
            console.log('Uploading file with size ' + file_size + ' MB');
            await s3ops.put_file_with_md5(bucket, file_name, file_size, data_multiplier);
            await s3ops.get_file_check_md5(bucket, file_name);
        }
    } catch (err) {
        saveErrorAndResume(`${server_ip} FAILED verification uploading and reading `, err);
        throw err;
    }
}

async function readFiles() {
    try {
        for (let file of files) {
            await s3ops.get_file_check_md5(bucket, file);
        }
    } catch (err) {
        saveErrorAndResume(`${server_ip} FAILED read file`, err);
        throw err;
    }
}

async function getRebuildReplicasStatus(key) {
    const read_object_mappings = await client.object.read_object_mappings({
        bucket,
        key,
        adminfo: true
    });
    const fileParts = read_object_mappings.parts;
    const filesReplicas = fileParts.map(part => part.chunk.frags[0].blocks);
    for (let i = 0; i < filesReplicas.length; i++) {
        const replicaStatusOnline = filesReplicas[i].filter(replica => replica.adminfo.online === true);
        if (replicaStatusOnline.length === replicas) {
            console.log('Part ' + i + ' contains 3 online replicas - as should');
        } else {
            throw new Error('Parts contain online replicas ' + replicaStatusOnline.length);
        }
    }
}

async function waitForRebuildReplicasParts(file) {
    console.log('Waiting for rebuild object ' + file);
    for (let retries = 1; retries <= 36; ++retries) {
        try {
            await getRebuildReplicasStatus(file);
            return true;
        } catch (e) {
            console.log(`Waiting for rebuild replicas parts ${file} - will wait for extra 5 seconds retries ${retries}`);
            await P.delay(5 * 1000);
        }
    }
    console.warn(`Waiting for rebuild replicas parts ${file} Failed`);
    return false;
}

async function getFilesChunksHealthStatus(key) {
    try {
        const read_object_mappings = await client.object.read_object_mappings({
            bucket,
            key,
            adminfo: true
        });
        const parts = read_object_mappings.parts;
        const chunkAvailable = parts.filter(chunk => chunk.chunk.adminfo.health === 'available').length;
        const chunkNum = parts.length;
        if (chunkAvailable === chunkNum) {
            console.log(`Available chunks number ${chunkAvailable} all amount chunks${chunkNum}`);
        } else {
            console.warn(`Some chunk of file ${key} has non available status`);
        }
    } catch (err) {
        console.warn('Read chunk with error ' + err);
    }

}

async function waitForRebuildChunks(file) {
    console.log('Waiting for rebuild object ' + file);
    for (let retries = 1; retries <= 36; ++retries) {
        try {
            await getFilesChunksHealthStatus(file);
            return;
        } catch (e) {
            console.log(`Waiting for rebuild replicas parts ${file} - will wait for extra 5 seconds retries ${retries}`);
            await P.delay(5 * 1000);
        }
    }
    throw new Error(`Waiting for rebuild replicas parts ${file} Failed`);
}

async function clean_up_dataset() {
    console.log('runing clean up files from bucket ' + bucket);
    try {
        await s3ops.delete_all_objects_in_bucket(bucket, true);
    } catch (err) {
        console.error(`Errors during deleting `, err);
    }
}

async function stopAgentAndCheckRebuildReplicas() {
    stopped_oses = await af.stopRandomAgents(azf, server_ip, failed_agents_number, suffix, oses);
    for (const file of files) {
        //waiting for rebuild files by chunks and parts
        await waitForRebuildReplicasParts(file);
        //Read and verify the read
        try {
            await getRebuildReplicasStatus(file);
            report.success('correct num replicas after node failure');
            console.log('File ' + file + ' rebuild replicas parts successfully');
        } catch (e) {
            report.fail('correct num replicas after node failure');
            saveErrorAndResume('File ' + file + ' didn\'t rebuild replicas parts');
        }
        await waitForRebuildChunks(file);
        try {
            await getFilesChunksHealthStatus(file);
            report.success('chunk healthy');
            console.log('File ' + file + ' rebuild files chunks successfully');
        } catch (e) {
            report.fail('chunk healthy');
            saveErrorAndResume('File ' + file + ' didn\'t rebuild files chunks');
        }
    }
    return readFiles;
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
    await azf.authenticate();
    await set_rpc_and_create_auth_token();
    try {
        await bf.changeTierSetting(bucket, data_frags, parity_frags, replicas);
        await af.clean_agents(azf, server_ip, suffix);
        const agents = await af.createRandomAgents(azf, server_ip, storage, vnet, agents_number, suffix, osesSet);
        oses = Array.from(agents.keys());
        //Create a dataset on it (1/4 GB per agent)
        await uploadAndVerifyFiles(agents_number);
        for (let cycle = 0; cycle < iterations_number; ++cycle) {
            console.log(`starting cycle number: ${cycle}`);
            await stopAgentAndCheckRebuildReplicas();
            await af.startOfflineAgents(azf, server_ip, stopped_oses);
        }
    } catch (err) {
        console.error('something went wrong :(' + err + errors);
        console.error(':( :( Errors during rebuild replicas parts test (replicas) ): ):' + errors);
        await report.report();
        process.exit(1);
    }
    await af.clean_agents(azf, server_ip, suffix);
    await clean_up_dataset();
    console.log(':) :) :) rebuild replicas parts test (replicas) were successful! (: (: (:');
    await report.report();
    process.exit(0);
}

main();
