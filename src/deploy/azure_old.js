/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for
 * license information.
 */
'use strict';

var util = require('util');
var P = require('../util/promise');
var msRestAzure = require('ms-rest-azure');
var ComputeManagementClient = require('azure-arm-compute');
var NetworkManagementClient = require('azure-arm-network');
var crypto = require('crypto');
var argv = require('minimist')(process.argv);
var _ = require('lodash');
// var SubscriptionManagementClient = require('azure-arm-resource').SubscriptionClient;


// Environment Setup
require('../util/dotenv').load();
_validateEnvironmentVariables();
var clientId = process.env.CLIENT_ID;
var domain = process.env.DOMAIN;
var secret = process.env.APPLICATION_SECRET;
var subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
var credentials;

//Sample Config
var location = argv.location || 'eastus';
var resourceGroupName = argv.resource || 'capacity';

var storageAccountName = argv.storage || 'capacitystorage';
var timestamp = (Math.floor(Date.now() / 1000));

var vnetName = argv.vnet || 'capacity-vnet';
var serverName;
var agentConf;
var subnetName = 'default';
// var networkInterfaceName;
// var ipConfigName;
// var domainNameLabel;
// var osDiskName;

var machineCount = 4;

// Ubuntu config
var publisher = 'Canonical';
var offer = 'UbuntuServer';
var sku = '14.04.3-LTS';
var osType = 'Linux';

// Windows config
if (argv.os === 'windows') {
    publisher = 'MicrosoftWindowsServer';
    offer = 'WindowsServer';
    sku = '2012-R2-Datacenter';
    osType = 'Windows';
}

var adminUsername = 'notadmin';
var adminPassword = 'Passw0rd123!';
var computeClient;
var networkClient;

///////////////////////////////////////
//Entrypoint for the vm-sample script//
///////////////////////////////////////
if (argv.help) {
    print_usage();
} else {
    vmOperations();
}

function args_builder(idx) {
    var publicIPName = 'testpip' + timestamp + idx;
    var vmName = 'agent-' + timestamp + idx + '-for-' + serverName.replace(/\./g, "-");
    if (osType === 'Windows') {
        var octets = serverName.split(".");
        var shasum = crypto.createHash('sha1');
        shasum.update(timestamp.toString() + idx);
        var dateSha = shasum.digest('hex');
        var postfix = dateSha.substring(dateSha.length - 7);
        vmName = octets[2] + '-' + octets[3] + 'W' + postfix;
        console.log('the windows machine name is: ', vmName);
    }
    var networkInterfaceName = 'testnic' + timestamp + idx;
    var ipConfigName = 'testcrpip' + timestamp + idx;
    var domainNameLabel = 'testdomainname' + timestamp + idx;
    var osDiskName = 'testosdisk' + timestamp + idx;
    return createVM(publicIPName, vmName, networkInterfaceName, ipConfigName, domainNameLabel, osDiskName);
}

function vmOperations(operationCallback) {
    ///////////////////////////////////////////////////////////////////////////////////
    //Task1: Create VM. This is a fairly complex task. Hence we have a wrapper method//
    //named createVM() that encapsulates the steps to create a VM. Other tasks are   //
    //fairly simple in comparison. Hence we don't have a wrapper method for them.    //
    ///////////////////////////////////////////////////////////////////////////////////
    var promises = [];
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
    return authenticatePromise()
        .then(creds => {
            credentials = creds;

            for (let i = 0; i < machineCount; i++) {
                promises.push(args_builder(i));
            }
            return P.all(promises);
        })
        .catch(err => {
            console.log('got error', err);
        });
}

function createVM(publicIPName, vmName, networkInterfaceName, ipConfigName, domainNameLabel, osDiskName) {
    //Get subscriptionId if not provided
    // resourceClient = new ResourceManagementClient(credentials, subscriptionId);
    computeClient = new ComputeManagementClient(credentials, subscriptionId);
    // storageClient = new StorageManagementClient(credentials, subscriptionId);
    networkClient = new NetworkManagementClient(credentials, subscriptionId);

    var nicInfo;
    var subnetInfo;

    return getSubnetInfoPromise()
        .then(result => {
            subnetInfo = result;
            // return createPublicIPPromise(domainNameLabel, publicIPName);
            return createNICPromise(subnetInfo, null, networkInterfaceName, ipConfigName);
        })
        // .then(ipInfo => createNICPromise(subnetInfo, ipInfo, networkInterfaceName, ipConfigName))
        .then(result => {
            nicInfo = result;
            console.log('\nCreated Network Interface:\n');
            return findVMImagePromise();
        })
        .then(vmImageInfo => {
            console.log('\nFound Vm Image:\n');
            return createVirtualMachinePromise(nicInfo.id, vmImageInfo[0].name, vmName, osDiskName);
        })
        .then(() => {
            console.log('\nStarted the Virtual Machine\n');
            if (osType === 'Linux') {
                return createVirtualMachineLinuxExtensionPromise(vmName);
            } else {
                return createVirtualMachineWindowsExtensionPromise(vmName);
            }
        })
        .then(result => {
            console.log(result);
        });
}

function authenticatePromise() {
    console.log('\nConnecting to Azure: ');
    return P.fromCallback(callback => msRestAzure.loginWithServicePrincipalSecret(clientId, secret, domain, callback));
}

function getSubnetInfoPromise() {
    console.log('\nGetting subnet info for: ' + subnetName);
    return P.fromCallback(callback => networkClient.subnets.get(resourceGroupName, vnetName, subnetName, callback));
}

function createNICPromise(subnetInfo, publicIPInfo, networkInterfaceName, ipConfigName) {
    var nicParameters = {
        location: location,
        ipConfigurations: [{
            name: ipConfigName,
            privateIPAllocationMethod: 'Dynamic',
            subnet: subnetInfo,
            // publicIPAddress: publicIPInfo
        }]
    };
    console.log('\nCreating Network Interface: ' + networkInterfaceName);
    return P.fromCallback(callback => networkClient.networkInterfaces.createOrUpdate(resourceGroupName, networkInterfaceName,
        nicParameters, callback));
}

// function createPublicIPPromise(domainNameLabel, publicIPName) {
//     var publicIPParameters = {
//         location: location,
//         publicIPAllocationMethod: 'Dynamic',
//         dnsSettings: {
//             domainNameLabel: domainNameLabel
//         }
//     };
//     console.log('\nCreating public IP: ' + publicIPName);
//     return P.fromCallback(callback => networkClient.publicIPAddresses.createOrUpdate(resourceGroupName, publicIPName,
//         publicIPParameters, callback));
// }

function findVMImagePromise() {
    console.log(util.format('\nFinding a VM Image for location %s from ' +
        'publisher %s with offer %s and sku %s', location, publisher, offer, sku));
    return P.fromCallback(callback => computeClient.virtualMachineImages.list(location, publisher, offer, sku, {
        top: 1
    }, callback));
}

function createVirtualMachinePromise(nicId, vmImageVersionNumber, vmName, osDiskName) {
    var vmParameters = {
        location: location,
        // tags: {
        //     env: serverName,
        //     agent_conf: agentConf,
        // },
        osProfile: {
            computerName: vmName,
            adminUsername: adminUsername,
            adminPassword: adminPassword
        },
        hardwareProfile: {
            vmSize: 'Standard_A2'
        },
        storageProfile: {
            imageReference: {
                publisher: publisher,
                offer: offer,
                sku: sku,
                // version: vmImageVersionNumber
                version: 'latest'
            },
            osDisk: {
                name: osDiskName,
                diskSizeGB: 1023,
                caching: 'None',
                createOption: 'fromImage',
                vhd: {
                    uri: 'https://' + storageAccountName + '.blob.core.windows.net/nodejscontainer/' + vmName + '-disk.vhd'
                }
            },
        },
        networkProfile: {
            networkInterfaces: [{
                id: nicId,
                primary: true
            }]
        }
    };
    console.log('\nCreating Virtual Machine: ' + vmName);
    return P.fromCallback(callback => computeClient.virtualMachines.createOrUpdate(resourceGroupName, vmName, vmParameters, callback));
}

function createVirtualMachineLinuxExtensionPromise(vmName) {
    var extensionParameters = {
        publisher: 'Microsoft.OSTCExtensions',
        virtualMachineExtensionType: 'CustomScriptForLinux', // it's a must - don't beleive Microsoft
        typeHandlerVersion: '1.5',
        autoUpgradeMinorVersion: true,
        settings: {
            fileUris: ["https://capacitystorage.blob.core.windows.net/agentscripts/init_agent.sh"],
            commandToExecute: 'bash init_agent.sh ' + serverName + ' ' + agentConf
        },
        protectedSettings: {
            storageAccountName: "capacitystorage",
            storageAccountKey: "2kMy7tNY8wm/PQdv0vdXOFnnAXhL77/jidKw6QfGt2q/vhfswRKAG5aUGqNamv8Bs6PEZ36SAw6AYVKePZwM9g=="
        },
        location: location,
    };
    console.log('\nRunning Virtual Machine Startup Script for Linux');
    return P.fromCallback(callback => computeClient.virtualMachineExtensions.createOrUpdate(resourceGroupName, vmName,
        'CustomScriptForLinux', extensionParameters, callback));
}

function createVirtualMachineWindowsExtensionPromise(vmName) {
    var extensionParameters = {
        publisher: 'Microsoft.Compute',
        virtualMachineExtensionType: 'CustomScriptExtension', // it's a must - don't beleive Microsoft
        typeHandlerVersion: '1.7',
        autoUpgradeMinorVersion: true,
        settings: {
            fileUris: ["https://capacitystorage.blob.core.windows.net/agentscripts/init_agent.ps1"],
            commandToExecute: 'powershell -ExecutionPolicy Unrestricted -File init_agent.ps1 ' + serverName + ' ' + agentConf
        },
        protectedSettings: {
            storageAccountName: "capacitystorage",
            storageAccountKey: "2kMy7tNY8wm/PQdv0vdXOFnnAXhL77/jidKw6QfGt2q/vhfswRKAG5aUGqNamv8Bs6PEZ36SAw6AYVKePZwM9g=="
        },
        location: location,
    };
    console.log('\nRunning Virtual Machine Startup Script for Windows');
    return P.fromCallback(callback => computeClient.virtualMachineExtensions.createOrUpdate(resourceGroupName, vmName,
        'CustomScriptForLinux', extensionParameters, callback));
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
