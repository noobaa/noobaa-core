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
var location = argv.location || 'eastus';
var resourceGroupName = argv.resource;
var storageAccountName = argv.storage;
var vnetName = argv.vnet;

var serverName = argv.server;
var agentConf = argv.agent_conf;

var oses = [{
    // Ubuntu 14 config - default
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
    // Centos 6.8 config
    publisher: 'OpenLogic',
    offer: 'CentOS',
    sku: '6.8',
    osType: 'Linux'
}, {
    // Centos 7 config
    publisher: 'OpenLogic',
    offer: 'CentOS',
    sku: '7.2',
    osType: 'Linux'
}, {
    // RHEL 6.7
    publisher: 'RedHat',
    offer: 'RHEL',
    sku: '6.7',
    version: 'latest'
}, {
    // RHEL 7.3
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

var azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resourceGroupName, location);
return azf.authenticate()
    .then(() => P.map(oses, os => azf.deleteVirtualMachine(os.offer.substring(0, 6) + os.sku.substring(0, 9))))
    .then(() => P.map(oses, os => azf.createAgent(os.offer.substring(0, 6) + os.sku.substring(0, 9), storageAccountName, vnetName, os, serverName, agentConf)));
