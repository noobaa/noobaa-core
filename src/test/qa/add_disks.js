/* Copyright (C) 2016 NooBaa */
'use strict';

var P = require('../../util/promise');
var AzureFunctions = require('../../deploy/azureFunctions');
var net = require('net');

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
var serverName = argv.app;
var agentConf = argv.agent_conf;
var size = argv.size;

var prefix;
if (net.isIP(serverName)) {
    var octets = serverName.split(".");
    prefix = octets[2] + '-' + octets[3];
} else {
    prefix = serverName.substring(0, 7);
}
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
                            fileUris: ['https://capacitystorage.blob.core.windows.net/agentscripts/ddisk.sh'],
                            commandToExecute: 'bash -x ddisk.sh ' + serverName + ' ' + agentConf
                        },
                        protectedSettings: {
                            storageAccountName: 'capacitystorage',
                            storageAccountKey: '2kMy7tNY8wm/PQdv0vdXOFnnAXhL77/jidKw6QfGt2q/vhfswRKAG5aUGqNamv8Bs6PEZ36SAw6AYVKePZwM9g=='
                        },
                        location: location,
                    };
                    console.log('running new extension to mount disk to file system');
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
