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
var net = require('net');
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

var os = {
    // Ubuntu 14 config - default
    publisher: 'Canonical',
    offer: 'UbuntuServer',
    sku: '14.04.3-LTS',
    osType: 'Linux'
};
if (argv.os === 'ubuntu16') {
    // Ubuntu 16 config
    os.publisher = 'Canonical';
    os.offer = 'UbuntuServer';
    os.sku = '16.04.0-LTS';
    os.osType = 'Linux';
} else if (argv.os === 'centos6') {
    // Centos 6.8 config
    os.publisher = 'OpenLogic';
    os.offer = 'CentOS';
    os.sku = '6.8';
    os.osType = 'Linux';
} else if (argv.os === 'centos7') {
    // Centos 6.8 config
    os.publisher = 'OpenLogic';
    os.offer = 'CentOS';
    os.sku = '7.2';
    os.osType = 'Linux';
} else if (argv.os === 'redhat6') {
    // RHEL 6.8 config
    os.publisher = 'RedHat';
    os.offer = 'RHEL';
    os.sku = '6.8';
    os.version = 'latest';
} else if (argv.os === 'redhat7') {
    // RHEL 7.2 config
    os.publisher = 'RedHat';
    os.offer = 'RHEL';
    os.sku = '7.2';
    os.version = 'latest';
} else if (argv.os === 'win2012R2') {
    // Windows 2012R2 config
    os.publisher = 'MicrosoftWindowsServer';
    os.offer = 'WindowsServer';
    os.sku = '2012-R2-Datacenter';
    os.osType = 'Windows';
} else if (argv.os === 'win2008R2') {
    // Windows 2008R2 config
    os.publisher = 'MicrosoftWindowsServer';
    os.offer = 'WindowsServer';
    os.sku = '2008-R2-SP1';
    os.osType = 'Windows';
} else if (argv.os === 'win2016') {
    // Windows 2016 config
    os.publisher = 'MicrosoftWindowsServer';
    os.offer = 'WindowsServer';
    os.sku = '2016-Datacenter';
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
        if (net.isIP(serverName)) {
            var octets = serverName.split(".");
            vmName = octets[2] + '-' + octets[3];
        } else {
            vmName = serverName.substring(0, 7);
        }
        var shasum = crypto.createHash('sha1');
        shasum.update(timestamp.toString() + i);
        var dateSha = shasum.digest('hex');
        var postfix = dateSha.substring(dateSha.length - 7);
        if (os.osType === 'Windows') {
            vmName += 'W' + postfix;
            console.log('the Windows machine name is: ', vmName);
        } else {
            vmName += 'Linux' + postfix;
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
    var prefix;
    if (net.isIP(serverName)) {
        var octets = serverName.split(".");
        prefix = octets[2] + '-' + octets[3];
    } else {
        prefix = serverName.substring(0, 7);
    }
    azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resourceGroupName, location);
    return azf.authenticate()
        .then(() => azf.listVirtualMachines(prefix, 'VM running'))
        .then(old_machines => {
            console.log('Machines with this prefix which are online', old_machines.length);
            var machines = [];
            if (old_machines.length < machineCount) {
                machines = args_builder(machineCount - old_machines.length);
                console.log('adding ', (machineCount - old_machines.length), 'machines');
                return P.map(machines, machine => azf.createAgent(machine, storageAccountName, vnetName, os, serverName, agentConf));
            }
            console.log('removing ', (old_machines.length - machineCount), 'machines');
            var todelete = old_machines.length - machineCount;
            if (todelete > 0) {
                var machines_to_del = [];
                for (let i = 0; i < todelete; i++) {
                    console.log(old_machines[i]);
                    machines_to_del.push(old_machines[i]);
                }
                return P.map(machines_to_del, machine => azf.deleteVirtualMachine(machine));
            }
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
  --os <name>                 the desired os for the agent (default is linux - ubuntu14)
                              ubuntu16/ubuntu14/centos6/win2012R2/win2008R2/win2016
`);
}
