/* Copyright (C) 2016 NooBaa */
'use strict';

var P = require('../../util/promise');
const _ = require('lodash');
var AzureFunctions = require('../../deploy/azureFunctions');
var crypto = require('crypto');
const s3ops = require('../qa/s3ops');

// Environment Setup
require('../../util/dotenv').load();
var clientId = process.env.CLIENT_ID;
var domain = process.env.DOMAIN;
var secret = process.env.APPLICATION_SECRET;
var subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
var shasum = crypto.createHash('sha1');
shasum.update(Date.now().toString());

// Sample Config
var argv = require('minimist')(process.argv);
var location = argv.location || 'eastus';
var resourceGroupName = argv.resource;
var storageAccountName = argv.storage;
var vnetName = argv.vnet;

var serverName = argv.server_ip;
var agentConf = argv.agent_conf;

//noobaa rpc
var api = require('../../api');
var rpc = api.new_rpc('wss://' + serverName + ':8443');
var client = rpc.new_client({});


var oses = [{
    // Ubuntu 14 config
    publisher: 'Canonical',
    offer: 'UbuntuServer',
    sku: '14.04.3-LTS',
    osType: 'Linux'
}, {
    // Ubuntu 16 config
    publisher: 'Canonical',
    offer: 'UbuntuServer',
    sku: '16.04.0-LTS',
    osType: 'Linux'
}, {
    // Ubuntu 12 config
    publisher: 'Canonical',
    offer: 'UbuntuServer',
    sku: '12.04.5-LTS',
    osType: 'Linux'
}, {
    // Centos 6.8 config
    publisher: 'OpenLogic',
    offer: 'CentOS',
    sku: '6.8',
    osType: 'Linux'
}, {
    // Centos 7 config
    publisher: 'OpenLogic',
    offer: 'CentOS',
    sku: '7.3',
    osType: 'Linux'
}, {
    // RHEL 6.8
    publisher: 'RedHat',
    offer: 'RHEL',
    sku: '6.8',
    version: 'latest'
}, {
    // RHEL 7.2
    publisher: 'RedHat',
    offer: 'RHEL',
    sku: '7.3',
    version: 'latest'
}, {
    // Windows 2012R2 config
    publisher: 'MicrosoftWindowsServer',
    offer: 'WindowsServer',
    sku: '2012-R2-Datacenter',
    osType: 'Windows'
}, {
    // Windows 2008R2 config
    publisher: 'MicrosoftWindowsServer',
    offer: 'WindowsServer',
    sku: '2008-R2-SP1',
    osType: 'Windows'
}, {
    // Windows 2016 config
    publisher: 'MicrosoftWindowsServer',
    offer: 'WindowsServer',
    sku: '2016-Datacenter',
    osType: 'Windows'
}];

let nodes = [];
let errors = [];
var initial_node_number = 0;

var azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resourceGroupName, location);
return azf.authenticate()
    .then(() => P.fcall(function() {
        var auth_params = {
            email: 'demo@noobaa.com',
            password: 'DeMo1',
            system: 'demo'
        };
        return client.create_auth_token(auth_params);
    }))
    .then(() => P.resolve(client.node.list_nodes({
        query: {
            skip_cloud_nodes: true
        }
    })))
    .then(res => {
        console.warn('Num nodes before the test are ', res.total_count);
        initial_node_number = res.total_count;
    })
    .then(() => P.map(oses, os => azf.createAgent(os.offer.substring(0, 7) + os.sku.substring(0, 4),
        storageAccountName, vnetName, os, serverName, agentConf).catch(err => errors.push(err.message))))
    .catch(err => errors.push(err.message))
    .then(() => console.warn('Will now wait for a minute for agents to come up...'))
    .delay(60000)
    .then(() => P.resolve(client.node.list_nodes({
        query: {
            skip_cloud_nodes: true
        }
    })))
    .then(res => {
        if (res.total_count === (initial_node_number + oses.length)) {
            console.warn('Num nodes after the test are ', res.total_count, '- as should - added', oses.length);
        } else {
            console.warn('Num nodes after the test are', res.total_count, '- something went wrong... suppose to add', oses.length);
            errors.push('Num nodes after the test are ' + res.total_count + ' - something went wrong... suppose to add ' + oses.length);
        }
        _.each(res.nodes, function(n) {
            nodes.push(n.name);
        });
        console.warn('Node names are', nodes);
    })
    .then(() => s3ops.put_file_with_md5(serverName, 'files', '100MB_File', 100))
    .catch(err => errors.push(err.message))
    .then(() => s3ops.get_file_check_md5(serverName, 'files', '100MB_File'))
    .catch(err => errors.push(err.message))
    .then(() => {
        console.warn('Will take diagnostics from all the agents');
        return P.map(nodes, node_name => client.node.collect_agent_diagnostics({
            name: node_name
        }).catch(err => errors.push(err.message)));
    })
    .then(() => {
        console.warn('Will put all agents in debug mode');
        return P.map(nodes, node_name => client.node.set_debug_node({
            node: {
                name: node_name
            },
            level: 5,
        }).catch(err => errors.push(err.message)));
    })
    .then(() => P.map(oses, os => azf.deleteVirtualMachineExtension(os.offer.substring(0, 7) + os.sku.substring(0, 4))
        .catch(err => errors.push(err.message))))
    .then(() => P.map(oses, os => {
        var extension = {
            publisher: 'Microsoft.OSTCExtensions',
            virtualMachineExtensionType: 'CustomScriptForLinux', // it's a must - don't beleive Microsoft
            typeHandlerVersion: '1.5',
            autoUpgradeMinorVersion: true,
            settings: {
                fileUris: ["https://pluginsstorage.blob.core.windows.net/agentscripts/remove_agent.sh"],
                commandToExecute: 'bash remove_agent.sh '
            },
            protectedSettings: {
                storageAccountName: "pluginsstorage",
                storageAccountKey: "bHabDjY34dXwITjXEasmQxI84QinJqiBZHiU+Vc1dqLNSKQxvFrZbVsfDshPriIB+XIaFVaQ2R3ua1YMDYYfHw=="
            },
            location: location,
        };
        if (os.osType === 'Windows') {
            extension.publisher = 'Microsoft.Compute';
            extension.virtualMachineExtensionType = 'CustomScriptExtension';
            extension.typeHandlerVersion = '1.7';
            extension.settings = {
                fileUris: ["https://pluginsstorage.blob.core.windows.net/agentscripts/remove_agent.ps1"],
                commandToExecute: 'powershell -ExecutionPolicy Unrestricted -File remove_agent.ps1 '
            };
        }
        return azf.createVirtualMachineExtension(os.offer.substring(0, 7) + os.sku.substring(0, 4), extension)
            .catch(err => errors.push(err.message));
    }))
    .then(() => P.map(oses, os => azf.deleteVirtualMachine(os.offer.substring(0, 7) + os.sku.substring(0, 4))
        .catch(err => errors.push(err.message))))
    .then(() => rpc.disconnect_all())
    .then(() => {
        if (errors.length === 0) {
            console.log('All is good :) - exiting...');
            process.exit(0);
        } else {
            console.log('Got the following errors in test:');
            _.each(errors, function(error) {
                console.log(error);
            });
            console.log('Failures in test :( - exiting...');
            process.exit(1);
        }
    });
