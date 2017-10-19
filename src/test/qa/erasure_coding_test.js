/* Copyright (C) 2016 NooBaa */
'use strict';

const argv = require('minimist')(process.argv);
const AzureFunctions = require('../../deploy/azureFunctions');
const P = require('../../util/promise');
const promise_utils = require('../../util/promise_utils');
const s3ops = require('../qa/s3ops');
const af = require('../qa/agent_functions');
const api = require('../../api');

require('../../util/dotenv').load();

//define colors
const YELLOW = "\x1b[33;1m";
const NC = "\x1b[0m";

const clientId = process.env.CLIENT_ID;
const domain = process.env.DOMAIN;
const secret = process.env.APPLICATION_SECRET;
const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
let stopped_agents = [];
let failures_in_test = false;
let errors = [];
let files = [];

//defining the required parameters
const {
    location = 'westus2',
    resource = 'pipeline-agents',
    storage = 'pipelineagentsdisks',
    vnet = 'pipeline-agents-vnet',
    agents_number = 4,
    failed_agents_number = 1,
    server_ip,
    bucket = 'first.bucket'
} = argv;
let oses = [];
let offlineAgents;

let osesSet = [
    'ubuntu12', 'ubuntu14', 'ubuntu16',
    'centos6', 'centos7',
    'redhat6', 'redhat7',
    'win2008', 'win2012', 'win2016'
];

const dataSet = [
    {size_units: "KB", data_size: 1},
    {size_units: "MB", data_size: 1},
    {size_units: "GB", data_size: 1},
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

function getRandomAgentsOses() {
    for (let i = 0; i < agents_number; i++) {
        let rand = Math.floor(Math.random() * osesSet.length);
        oses.push(osesSet[rand]);
        osesSet.splice(rand, 1);
    }
    console.log('Random oses for creating agents ', oses);
}

function getRandomStoppingOses() {
    for (let i = 0; i < failed_agents_number; i++) {
        let rand = Math.floor(Math.random() * oses.length);
        stopped_agents.push(oses[rand]);
        oses.splice(rand, 1);
    }
    console.log('Random oses for stopping agents ', stopped_agents);
}

function saveErrorAndResume(message) {
    console.error(message);
    errors.push(message);
}

console.log(`${YELLOW}resource: ${resource}, storage: ${storage}, vnet: ${vnet}${NC}`);
const azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resource, location);

function uploadAndVerify() {
       return P.each(dataSet, size => {
           let { data_multiplier } = unit_mapping[size.size_units.toUpperCase()];
           let file_name = 'file_' + size.data_size + size.size_units + (Math.floor(Date.now() / 1000));
                files.push(file_name);
                return s3ops.put_file_with_md5(server_ip, bucket, file_name, size.data_size, data_multiplier)
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

function getRebuildChunksStatus(key) {
    let result = false;
   // let replicaStatusOnline = [];
   // let replicas = [];
    const rpc = api.new_rpc_default_only('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    rpc.disable_validation();
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
            let chunkAvailable = res.parts.filter(chunk => chunk.chunk.adminfo.health === 'available').length;
            let chunkNum = res.parts.length;
            if (chunkAvailable === chunkNum) {
                console.log('Available chunks number ' + chunkAvailable + ' all amount chunks ' + chunkNum);
                result = true;
            } else {
                console.warn('Some chunk of file ' + key + ' has non available status');
                result = false;
            }
        })
        .catch(err => console.warn('Read chunk with error ' + err))
        .then(() => result);
}

function waitForAgentsAmount(numberAgents) {
    let agents;
    let retries = 0;
    console.log('Waiting for server getting up all agents ' + numberAgents);
    return promise_utils.pwhile(
        () => agents !== numberAgents && retries !== 36,
        () => P.resolve(af.list_nodes(server_ip))
            .then(res => {
                if (res) {
                    agents = res.length;
                } else {
                    retries += 1;
                    console.log('Current agents : ' + agents + ' waiting for: ' + numberAgents + ' - will wait for extra 5 seconds');
                }
            })
            .delay(5000));
}

function waitForRebuildObjects(file) {
    let retries = 0;
    let rebuild = false;
    console.log('Waiting for rebuild object ' + file);
    return promise_utils.pwhile(
        () => rebuild === false && retries !== 36,
        () => P.resolve(getRebuildChunksStatus(file))
            .then(res => {
                if (res) {
                    rebuild = res;
                } else {
                    retries += 1;
                    console.log('Waiting for rebuild object' + file + ' - will wait for extra 5 seconds retries ' + retries);
                }
            })
            .catch(e => console.warn('Waiting for rebuild file ' + file + 'with error ' + e))
            .delay(5000));
}

return azf.authenticate()
    .then(getRandomAgentsOses)
    .then(() => af.number_offline_agents(server_ip))
    .then(res => {
        offlineAgents = res;
        console.log('Offline agents number before stopping is ', offlineAgents);
    })
    .then(() => af.create_agents(azf, server_ip, storage, vnet, ...oses))
    .then(uploadAndVerify)
    .then(getRandomStoppingOses)
    .then(() => P.each(stopped_agents, agent => af.stop_agent(azf, agent)))
    .then(readFiles)
    .then(() => P.each(files, file => waitForRebuildObjects(file)))
    .then(() => af.number_offline_agents(server_ip))
    .then(res => {
        const offlineAgentsAfter = res;
        const offlineExpected = offlineAgents + failed_agents_number;
        if (offlineAgentsAfter === offlineExpected) {
            console.log('Number of offline agents is ', offlineAgentsAfter, ' - as should');
        } else {
            saveErrorAndResume('After switched off agent number offline is ', offlineAgentsAfter, ' instead ', offlineExpected);
            failures_in_test = true;
        }
    })
    .then(() => af.list_optimal_agents(server_ip, ...oses))
    .then(res => {
        const onlineAgents = res.length;
        const expectedOnlineAgents = agents_number - failed_agents_number;
        if (onlineAgents === expectedOnlineAgents) {
            console.log('Number online agents is ', onlineAgents, ' - as should');
        } else {
            saveErrorAndResume('After switching off some agents number agents online ', onlineAgents, ' instead ', expectedOnlineAgents);
            failures_in_test = true;
        }
    })
    .then(readFiles)
    .then(uploadAndVerify)
    .then(() => {
        P.each(stopped_agents, agent => {
            af.start_agent(azf, agent);
            oses.push(agent);
        });
    })
    .then(() => waitForAgentsAmount(agents_number))
    .then(() => af.list_nodes(server_ip))
    .then(res => {
        let onlineAgentsOn = res.length;
        if (onlineAgentsOn === agents_number) {
            console.log('Number of online agents is ', onlineAgentsOn, ' - as should');
        } else {
            saveErrorAndResume('After switching on agents number online is ' + onlineAgentsOn + ' instead ', agents_number);
            failures_in_test = true;
        }
    })
    .then(() => af.list_optimal_agents(server_ip, ...oses))
    .then(res => {
        let onlineAgentsOn = res.length;
        if (onlineAgentsOn === agents_number) {
            console.log('Number of online agents is ', onlineAgentsOn, ' - as should');
        } else {
            saveErrorAndResume('After switching on agents number online is ', onlineAgentsOn, ' instead ', agents_number);
            failures_in_test = true;
        }
    })
    .then(uploadAndVerify)
    .catch(err => {
        console.error('something went wrong :(' + err + errors);
        failures_in_test = true;
    })
    .finally(() => af.clean_agents(azf, ...oses))
    .then(() => {
        if (failures_in_test) {
            console.error(':( :( Errors during connectivity test ): ):' + errors);
            process.exit(1);
        }
        console.log(':) :) :) connectivity test were successful! (: (: (:');
        process.exit(0);
    });
