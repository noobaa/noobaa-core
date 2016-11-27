/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for
 * license information.
 */
'use strict';

var util = require('util');
var P = require('../util/promise');
var AzureFunctions = require('./azureFunctions');
var promise_utils = require('../util/promise_utils');
var crypto = require('crypto');
var argv = require('minimist')(process.argv);
var _ = require('lodash');


// Environment Setup
require('../util/dotenv').load();
_validateEnvironmentVariables();
var clientId = process.env.CLIENT_ID;
var domain = process.env.DOMAIN;
var secret = process.env.APPLICATION_SECRET;
var subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;

//Sample Config
var location = argv.location || 'eastus';
var resourceGroupName = argv.resource || 'capacity';

var storageAccountName = argv.storage || 'capacitystorage';
var timestamp = (Math.floor(Date.now() / 1000));

var vnetName = argv.vnet || 'capacity-vnet';
var serverName;
var agentConf;

var machineCount = 4;

// Ubuntu config
var os = {
    publisher: 'Canonical',
    offer: 'UbuntuServer',
    sku: '14.04.3-LTS',
    osType: 'Linux'
};

// Windows config
if (argv.os === 'windows') {
    os.publisher = 'MicrosoftWindowsServer';
    os.offer = 'WindowsServer';
    os.sku = '2012-R2-Datacenter';
    os.osType = 'Windows';
}
var azf;

///////////////////////////////////////
//Entrypoint for the vm-sample script//
///////////////////////////////////////
if (argv.help) {
    print_usage();
} else {
    vmOperations();
}

function args_builder(count) {
    var vmNames = [];
    for (let i = 0; i < count; i++) {
        var vmName;
        var octets = serverName.split(".");
        var shasum = crypto.createHash('sha1');
        shasum.update(timestamp.toString() + i);
        var dateSha = shasum.digest('hex');
        var postfix = dateSha.substring(dateSha.length - 7);
        if (os.osType === 'Windows') {
            vmName = octets[2] + '-' + octets[3] + 'W' + postfix;
            console.log('the Windows machine name is: ', vmName);
        } else {
            vmName = octets[2] + '-' + octets[3] + 'Linux' + postfix;
            console.log('the Linux machine name is: ', vmName);
        }
        vmNames.push(vmName);
    }
    return vmNames;
}

function vmOperations(operationCallback) {
    ///////////////////////////////////////////////////////////////////////////////////
    //Task1: Create VM. This is a fairly complex task. Hence we have a wrapper method//
    //named createVM() that encapsulates the steps to create a VM. Other tasks are   //
    //fairly simple in comparison. Hence we don't have a wrapper method for them.    //
    ///////////////////////////////////////////////////////////////////////////////////
    if (_.isUndefined(argv.agent_conf)) {

        console.error('\n\n******************************************');
        console.error('Please provide --agent_conf (base64, copy from UI)');
        console.error('******************************************\n\n');
        throw new Error('MISSING --agent_conf');
    } else {
        agentConf = argv.agent_conf;
    }
    if (_.isUndefined(argv.app)) {

        console.error('\n\n******************************************');
        console.error('Please provide --app (used to be heroku app name.');
        console.error('currently just tag for reference - use the metadata server address)');
        console.error('******************************************\n\n');
        throw new Error('MISSING --app');
    } else {
        serverName = argv.app;
    }
    if (_.isUndefined(argv.scale)) {

        console.error('\n\n******************************************');
        console.error('Please provide --scale (choose the number of agents you want to add)');
        console.error('******************************************\n\n');
        throw new Error('MISSING --scale');
    } else {
        machineCount = argv.scale;
    }
    var octets = serverName.split(".");
    var prefix = octets[2] + '-' + octets[3];
    azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resourceGroupName, location);
    return azf.authenticate()
        .then(() => azf.countOnMachines(prefix))
        .then(count => {
            var machines = [];
            console.log('Machines with this prefix which are online', count);
            if (count < machineCount) {
                machines = args_builder(machineCount - count);
                console.log('adding ', (machineCount - count), 'machines');
                return P.map(machines, machine => azf.createAgent(machine, storageAccountName, vnetName, os, serverName, agentConf));
            }
            console.log('removing ', (count - machineCount), 'machines');
            var todelete = count - machineCount;
            var deleted = 0;
            return promise_utils.pwhile(
                function() {
                    return (deleted < todelete);
                },
                function() {
                    return azf.getRandomMachine(prefix, 'VM running')
                        .then(machine => {
                            console.log('deleting machine', machine);
                            return azf.deleteVirtualMachine(machine);
                        })
                        .then(() => deleted++);
                });
        })
        .catch(err => {
            console.log('got error', err);
        });
}

function _validateEnvironmentVariables() {
    var envs = [];
    if (!process.env.CLIENT_ID) envs.push('CLIENT_ID');
    if (!process.env.DOMAIN) envs.push('DOMAIN');
    if (!process.env.APPLICATION_SECRET) envs.push('APPLICATION_SECRET');
    if (envs.length > 0) {
        throw new Error(util.format('please set/export the following environment variables: %s', envs.toString()));
    }
}

function print_usage() {
    console.log(`
Usage:
  --help                      show this usage
  --app <noobaa-ip>           the IP of noobaa server to add agents to
  --scale <agents-number>     the number of agents to add
  --agent_conf <agent_conf>   the base64 configuration from the server
  --location <location>       the azure location you want to use (default is eastus)
  --resource <resource-group> the azure resource group to use (default is capacity)
  --storage <storage-account> the azure storage account to use (default is capacitystorage)
  --vnet <vnet>               the azure virtual network to use (default is capacity-vnet)
  --os <linux/windows>        the desired os for the agent (default is linux - ubuntu)
`);
}
