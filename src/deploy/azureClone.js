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
var vnet = argv.vnet;
var source = argv.source;
var clone = argv.clone;


var timestamp = (Math.floor(Date.now() / 1000));
var networkInterfaceName = clone + '_nic' + timestamp;
var ipConfigName = clone + '_pip' + timestamp;

var azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resource, location);
azf.authenticate().then(() => azf.cloneVM(source, clone, networkInterfaceName, ipConfigName, vnet));
