/* eslint-disable header/header */
/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for
 * license information.
 */
'use strict';

var util = require('util');
var P = require('../util/promise');
var AzureFunctions = require('./azureFunctions');
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
var location = argv.location || 'westus2';
var resourceGroupName = argv.resource || 'newcapacity';

var storageAccountName = argv.storage || 'capacitystorage';
var timestamp = (Math.floor(Date.now() / 1000));

var vnetName = argv.vnet || 'newcapacity-vnet';
var serverName;
var agentConf = argv.agent_conf;

var machineCount = 4;

var azf;

function print_usage() {
    console.log(`
Usage:
  --help                      show this usage
  --app <noobaa-ip>           the IP of noobaa server to add agents to
  --scale <agents-number>     the number of agents to add
  --agent_conf <agent_conf>   the base64 configuration from the server
  --location <location>       the azure location you want to use (default: ${location})
  --resource <resource-group> the azure resource group to use (default: ${resourceGroupName})
  --storage <storage-account> the azure storage account to use (default: ${storageAccountName})
  --vnet <vnet>               the azure virtual network to use (default: ${vnetName})
  --os <name>                 the desired os for the agent (default is linux - ubuntu14)
                              ubuntu16/ubuntu14/centos6/win2012/win2008/win2016
`);
}

///////////////////////////////////////
//Entrypoint for the vm-sample script//
///////////////////////////////////////
if (argv.help) {
    print_usage();
} else {
    vmOperations();
}

var oses = [
    'ubuntu14', 'ubuntu16', 'ubuntu12',
    'centos6', 'centos7',
    'redhat6', 'redhat7',
    'win2008', 'win2012', 'win2016'
];

function args_builder(count, os) {
    var vmNames = [];
    for (let i = 0; i < count; i++) {
        var vmName;
        if (net.isIP(serverName)) {
            var octets = serverName.split(".");
            vmName = 'a' + octets[2] + '-' + octets[3];
        } else {
            vmName = 'a' + serverName.substring(0, 7);
        }
        var shasum = crypto.createHash('sha1');
        shasum.update(timestamp.toString() + i);
        var dateSha = shasum.digest('hex');
        var postfix = dateSha.substring(dateSha.length - 6);
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
    if (_.isUndefined(argv.app)) {

        console.error('\n\n******************************************');
        console.error('Please provide --app (used to be heroku app name.');
        console.error('currently just tag for reference - use the metadata server address)');
        console.error('******************************************\n\n');
        throw new Error('MISSING --app');
    } else {
        serverName = argv.app;
    }
    if (_.isUndefined(argv.scale) && _.isUndefined(argv.addallimages) && _.isUndefined(argv.servers)) {

        console.error('\n\n******************************************');
        console.error('Please provide --scale (choose the number of agents you want to add) or --addallimages of --servers');
        console.error('******************************************\n\n');
        throw new Error('MISSING --scale/--addallimages/--servers');
    } else {
        machineCount = argv.scale;
    }
    var prefix;
    if (net.isIP(serverName)) {
        var octets = serverName.split(".");
        prefix = 'a' + octets[2] + '-' + octets[3];
    } else {
        prefix = 'a' + serverName.substring(0, 7);
    }
    azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resourceGroupName, location);
    return azf.authenticate()
        .then(() => azf.listVirtualMachines(prefix, 'VM running'))
        .then(old_machines => {
            console.log('Machines with this prefix which are online', old_machines.length);
            var machines = [];
            if (argv.addallimages) {
                console.log('adding all prossible machine types');
                return P.map(oses, osname => {
                    var os2 = azf.getImagesfromOSname(osname);
                    var machine_name = prefix + osname;
                    if (os2.osType === 'Windows') {
                        machine_name = machine_name.substring(0, 15);
                    }
                    return azf.createAgent({
                        vmName: machine_name,
                        storage: storageAccountName,
                        vnet: vnetName,
                        os: os2,
                        serverName,
                        agentConf
                    })
                        .catch(err => console.log('got error with agent', err));
                });
            }
            if (argv.servers) {
                var servers = [];
                for (let i = 0; i < argv.servers; ++i) {
                    servers.push({
                        name: argv.app + i,
                        secret: '',
                        ip: ''
                    });
                }
                return P.map(servers, server => azf.createServer(server.name, vnetName, storageAccountName)
                    .then(new_secret => {
                        server.secret = new_secret;
                        return azf.getIpAddress(server.name + '_pip');
                    })
                    .then(ip => {
                        server.ip = ip;
                        return ip;
                    })
                )
                    .then(() => {
                        if (argv.servers > 1) {
                            var slaves = Array.from(servers);
                            var master = slaves.pop();
                            return P.each(slaves, slave => azf.addServerToCluster(master.ip, slave.ip, slave.secret));
                        }
                    })
                    .then(() => {
                        var server = servers[servers.length - 1];
                        console.log('Cluster/Server:', server.name, 'was successfuly created, ip is:', server.ip);
                    });
            }
            if (old_machines.length < machineCount) {
                var os = azf.getImagesfromOSname(argv.os);
                machines = args_builder(machineCount - old_machines.length, os);
                console.log('adding ', (machineCount - old_machines.length), 'machines');
                return P.map(machines, machine => azf.createAgent({
                    vmName: machine,
                    storage: storageAccountName,
                    vnet: vnetName,
                    os,
                    serverName,
                    agentConf
                })
                    .catch(err => console.log('got error with agent', err)));
            }
            console.log('removing ', (old_machines.length - machineCount), 'machines');
            var todelete = old_machines.length - machineCount;
            if (todelete > 0) {
                var machines_to_del = [];
                for (let i = 0; i < todelete; ++i) {
                    console.log(old_machines[i]);
                    machines_to_del.push(old_machines[i]);
                }
                return P.map(machines_to_del, machine => azf.deleteVirtualMachine(machine)
                    .catch(err => console.log('got error with agent', err)));
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
