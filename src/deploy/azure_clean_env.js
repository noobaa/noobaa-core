/* Copyright (C) 2016 NooBaa */
'use strict';

const argv = require('minimist')(process.argv);
const dbg = require('../util/debug_module')(__filename);
const AzureFunctions = require('../deploy/azureFunctions');
const P = require('../util/promise');
dbg.set_process_name('clean_azure_env');
let azf;

const {
    resource,
    storage,
    vnet,
    location = 'westus2',
} = argv;

let {
    id
} = argv;

function usage() {
    console.log(`
    --resource  -   The azure resource group to use
    --storage   -   The azure storage account to use
    --vnet      -   The azure virtual network to use
    --location  -   The VM's location (default ${location})
    --id        -   The VM's id
    --help      -   show this help.
    `);
}

if (argv.help) {
    usage();
    process.exit(1);
}

function _validateEnvironmentVariablesAndBaseParams() {
    const clientId = process.env.CLIENT_ID;
    const domain = process.env.DOMAIN;
    const secret = process.env.APPLICATION_SECRET;
    const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;

    let missing_args = '';
    //Verify ENV
    if (!process.env.CLIENT_ID) missing_args.push('\tmissing env parameter CLIENT_ID\n');
    if (!process.env.DOMAIN) missing_args.push('\tmissing env parameter DOMAIN\n');
    if (!process.env.APPLICATION_SECRET) missing_args.push('\tmissing env parameter APPLICATION_SECRET\n');

    //Verify base params supplied

    if (!resource) {
        missing_args += '\t--resource <resource-group>\n';
    }
    if (!storage) {
        missing_args += '\t--storage <storage-account>\n';
    }
    if (!vnet) {
        missing_args += '\t--vnet <vnet>\n';
    }

    if (argv.id) {
        id = '-' + id;
    } else {
        id = '';
    }

    azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resource, location);
}

async function delete_vm(status) {
    const current_vms = await azf.listVirtualMachines('', status);
    console.log(`Found ${current_vms.length} machines with status ${status}`);
    await P.map(current_vms, vmName => {
        if (vmName.includes(id) && !vmName.toLowerCase().includes('lg') && !vmName.toLowerCase().includes('jenkins')) {
            console.log('Cleaning machine: ' + vmName);
            return azf.deleteVirtualMachine(vmName)
                .catch(err => {
                    console.error(`failed deleting ${vmName} with error: `, err.message);
                    throw new Error(`failed deleting ${vmName} with error: `, err.message);
                });
        }
    }, { concurrency: 30 });
}

async function main() {
    try {
        await azf.authenticate();
        let keep_run = true;
        let retry = 0;
        const MAX_RETRY = 3;
        while (keep_run) {
            try {
                const status_list = ['VM running', 'VM stopped', 'VM Failure', 'VM generalized', 'VM deallocated'];
                for (const status of status_list) {
                    await delete_vm(status);
                }
                keep_run = false;
            } catch (e) {
                if (retry <= MAX_RETRY) {
                    retry += 1;
                    console.error(e);
                    console.log(`Sleeping for 30 min and retrying`);
                    await P.delay(30 * 60 * 1000);
                } else {
                    throw e;
                }
            }
        }
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

_validateEnvironmentVariablesAndBaseParams();
P.resolve()
    .then(main);
