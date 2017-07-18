/* Copyright (C) 2016 NooBaa */
'use strict';

const azure_storage = require('azure-storage');
const package_json = require('../../package.json');

// Tagging azure API using the user-agent header as requested by the azure storage PM team
azure_storage.Constants.USER_AGENT_PRODUCT_NAME = 'APN/1.0 NooBaa/1.0 NooBaaCore';
azure_storage.Constants.USER_AGENT_PRODUCT_VERSION = package_json.version || '0.0.0';

module.exports = azure_storage;
