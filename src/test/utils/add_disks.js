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
            return azf.addDataDiskToVM({ vm, size, storage: storageAccountName })
                .then(() => azf.rescanDataDisksExtension(vm))
                .catch(err => {
                    console.log('got error', err);
                });
        });
    })
    .catch(err => {
        console.log('got error', err);
    });
