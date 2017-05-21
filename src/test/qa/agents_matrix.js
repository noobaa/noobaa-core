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
console.log(argv);
var location = argv.location || 'westus2';
var resourceGroupName = argv.resource;
var storageAccountName = argv.storage;
var vnetName = argv.vnet;
var serverName = argv.server_ip;
var agentConf = argv.agent_conf;

//noobaa rpc
var api = require('../../api');
var rpc = api.new_rpc('wss://' + serverName + ':8443');
rpc.disable_validation();
var client = rpc.new_client({});


var oses = [
    'ubuntu14', 'ubuntu16', 'ubuntu12', 'centos6', 'centos7', 'redhat6', 'redhat7', 'win2008', 'win2012', 'win2016'
];

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
    .then(() => {
        if (!argv.skipsetup) {
            return P.map(oses, osname =>
                    azf.deleteVirtualMachine(osname)
                    .catch(err => console.log('VM not found - skipping...', err))
                )
                .then(() => P.map(oses, osname => {
                    var os = azf.getImagesfromOSname(osname);
                    return azf.createAgent(osname, storageAccountName, vnetName,
                        os, serverName, agentConf).catch(err => errors.push(err.message));
                }))
                .then(() => console.warn('Will now wait for a minute for agents to come up...'))
                .delay(60000)
                .then(() => P.resolve(client.node.list_nodes({
                    query: {
                        online: true,
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
                });
        }
        return P.resolve(client.node.list_nodes({
            query: {
                online: true,
                skip_cloud_nodes: true
            }
        })).then(res => {
            initial_node_number = res.total_count;
            console.warn('Num nodes before the test are ', res.total_count);
            initial_node_number = res.total_count;
            _.each(res.nodes, function(n) {
                nodes.push(n.name);
            });
            console.warn('Node names are', nodes);
        });
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
    .then(() => {
        if (!argv.skipsetup) {
            return P.map(oses, osname => azf.deleteVirtualMachineExtension(osname).catch(err => console.log(err.message)))
                .then(() => P.map(oses, osname => {
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
                    var os = azf.getImagesfromOSname(osname);
                    if (os.osType === 'Windows') {
                        extension.publisher = 'Microsoft.Compute';
                        extension.virtualMachineExtensionType = 'CustomScriptExtension';
                        extension.typeHandlerVersion = '1.7';
                        extension.settings = {
                            fileUris: ["https://pluginsstorage.blob.core.windows.net/agentscripts/remove_agent.ps1"],
                            commandToExecute: 'powershell -ExecutionPolicy Unrestricted -File remove_agent.ps1 '
                        };
                    }
                    return azf.createVirtualMachineExtension(osname, extension).catch(err => errors.push(err.message));
                }))
                .delay(60000)
                .then(() => P.resolve(client.node.list_nodes({
                    query: {
                        online: true,
                        skip_cloud_nodes: true
                    }
                })))
                .then(res => {
                    if (res.total_count === initial_node_number) {
                        console.warn('Num nodes after the test are ', res.total_count, '- the same as before - good');
                    } else {
                        console.warn('Num nodes after the test are', res.total_count, '- something went wrong... suppose to go back to initial size', initial_node_number);
                        errors.push('Num nodes after the test are ' + res.total_count + ' - something went wrong... suppose to go back to initial size ' + initial_node_number);
                    }
                });
        }
    })
    .then(() => rpc.disconnect_all())
    .then(() => {
        if (errors.length === 0) {
            console.log('All is good :) - exiting...');
            if (!argv.skipsetup) {
                return P.map(oses, osname => azf.deleteVirtualMachine(osname));
            }
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
