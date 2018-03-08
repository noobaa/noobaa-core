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
        id = '-';
    }

    azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resource, location);
}

function main() {
    let exit_code = 0;
    return azf.authenticate()
        .then(() => azf.listVirtualMachines('', 'VM running'))
        .then(current_vms => P.map(current_vms, vmName => {
            if (vmName.includes(id) && !vmName.toLowerCase().includes('lg')) {
                console.log('Cleaning machine:' + vmName);
                return azf.deleteVirtualMachine(vmName)
                    .catch(err => {
                        console.error(`failed deleting ${vmName} with error: `, err.message);
                        exit_code = 1;
                    });
            }
        }))
        .then(() => process.exit(exit_code));
}

_validateEnvironmentVariablesAndBaseParams();
main();
