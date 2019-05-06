/* Copyright (C) 2016 NooBaa */
'use strict';

const AzureFunctions = require('../deploy/azureFunctions');
const dbg = require('../util/debug_module')(__filename);
const argv = require('minimist')(process.argv);
dbg.set_process_name('azureAddHD');

const clientId = process.env.CLIENT_ID;
const domain = process.env.DOMAIN;
const secret = process.env.APPLICATION_SECRET;
const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;

const {
    resource,
    storage,
    location = 'westus2',
    agent_name,
    add = 1,
    size = 16, //size in GB
    help = false
} = argv;

function usage() {
    console.log(`
    --location      -   azure location (default: ${location})
    --resource      -   azure resource group
    --storage       -   azure storage on the resource group
    --agent_name    -   The agent name
    --size          -   HD size (default: ${size})
    --add           -   number of HD to add (default: ${add})
    --clean         -   will only delete the env and exit.
    --help          -   show this help
    `);
}

if (help) {
    usage();
    process.exit(1);
}

var azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resource, location);

async function addDisksToMachine(machineName, diskSize, numberToAdd) {
    console.log(`machineName: ${machineName}, diskSize ${diskSize}, numberToAdd ${numberToAdd}`);
    console.log(`adding disks to the agents machine`);
    console.log(`adding data disk to vm ${machineName} of size ${diskSize}`);
    await azf.addDataDiskToVM({
        vm: machineName,
        size: diskSize,
        storage,
        number_of_disks: numberToAdd,
    });
}

async function main() {
    await azf.authenticate();
    await addDisksToMachine(agent_name, size, add);
}

main();
