/* Copyright (C) 2016 NooBaa */
'use strict';

require('../util/dotenv').load();

var AzureFunctions = require('./azureFunctions');
const argv = require('minimist')(process.argv);

var clientId = process.env.CLIENT_ID;
var domain = process.env.DOMAIN;
var secret = process.env.APPLICATION_SECRET;
var subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;

var resource = argv.resource;
var location = argv.location || 'eastus';
var source = argv.source;

var image = argv.image;
var prefix = argv.vhd_prefix;

var azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resource, location);
azf.authenticate()
    .then(() => {
        if (prefix) {
            return azf.captureVirtualMachine(source, prefix, 'images', true);
        }
        if (image) {
            return azf.startVirtualMachineFromVHD(source, image);
        }
        console.log('No prefix nor image was provided - won\'t do nothing...');
    });
