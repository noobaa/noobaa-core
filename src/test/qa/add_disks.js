/* Copyright (C) 2016 NooBaa */
'use strict';

var P = require('../../util/promise');
var AzureFunctions = require('../../deploy/azureFunctions');

// Environment Setup
require('../../util/dotenv').load();
var clientId = process.env.CLIENT_ID;
var domain = process.env.DOMAIN;
var secret = process.env.APPLICATION_SECRET;
var subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;

// Sample Config
var argv = require('minimist')(process.argv);
var location = argv.location || 'westus2';
var resourceGroupName = argv.resource;
var storageAccountName = argv.storage;
var prefix = argv.prefix;
//var agentConf = argv.agent_conf;
var size = argv.size;

// var prefix;
// if (net.isIP(serverName)) {
//     var octets = serverName.split(".");
//     prefix = octets[2] + '-' + octets[3];
// } else {
//     prefix = serverName.substring(0, 7);
// }
var azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resourceGroupName, location);
return azf.authenticate()
    .then(() => azf.listVirtualMachines(prefix, 'VM running'))
    .then(machines => {
        console.log('machines found are', machines);
        return P.map(machines, vm => {
            console.log('adding data disk to vm', vm, 'of size', size);
            return azf.addDataDiskToVM(vm, size, storageAccountName)
                .then(() => {
                    console.log('removing old extension (if exist)');
                    return azf.deleteVirtualMachineExtension(vm);
                })
                .then(() => {
                    var extension = {
                        publisher: 'Microsoft.OSTCExtensions',
                        virtualMachineExtensionType: 'CustomScriptForLinux', // it's a must - don't beleive Microsoft
                        typeHandlerVersion: '1.5',
                        autoUpgradeMinorVersion: true,
                        settings: {
                            fileUris: ['https://pluginsstorage.blob.core.windows.net/agentscripts/ddisk.sh'],
                            commandToExecute: 'bash -x ddisk.sh '
                        },
                        protectedSettings: {
                            storageAccountName: 'pluginsstorage',
                            storageAccountKey: 'bHabDjY34dXwITjXEasmQxI84QinJqiBZHiU+Vc1dqLNSKQxvFrZbVsfDshPriIB+XIaFVaQ2R3ua1YMDYYfHw=='
                        },
                        location: location,
                    };
                    if (vm.includes('Linux')) {
                        console.log('running new extension to mount disk to file system for Linux');
                    } else {
                        extension.publisher = 'Microsoft.Compute';
                        extension.virtualMachineExtensionType = 'CustomScriptExtension';
                        extension.typeHandlerVersion = '1.7';
                        extension.settings = {
                            fileUris: ["https://pluginsstorage.blob.core.windows.net/agentscripts/ddisk.ps1"],
                            commandToExecute: 'powershell -ExecutionPolicy Unrestricted -File ddisk.ps1 '
                        };
                        console.log('running new extension to mount disk to file system for Windows');
                    }
                    return azf.createVirtualMachineExtension(vm, extension);
                })
                .catch(err => {
                    console.log('got error', err);
                });
        });
    })
    .catch(err => {
        console.log('got error', err);
    });
