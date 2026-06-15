/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
require('../util/dotenv').load();
const argv = require('minimist')(process.argv);

//TODO: add get azure storage and vnet from the resorce group and remove this if
if (argv.help !== undefined) {
    return;
} else if (argv.storage === undefined && argv.help === undefined) {
    console.error('The --storage flag must be provided');
    throw new Error('The --storage flag must be provided');
}

const storage = argv.storage;
if (typeof storage !== 'string' || !/^[a-z0-9]+$/.test(storage)) {
    console.error('Invalid storage account name. Must be alphanumeric lowercase.');
    throw new Error('Invalid storage account name');
}

let isStringFound = false;
_.each(process.env, envKey => {
    if (typeof envKey === 'string' && envKey.includes(storage)) {
        process.env.AZURE_STORAGE_CONNECTION_STRING = envKey;
        isStringFound = true;
    }
});

if (!isStringFound) {
    console.error('Configured connection string in .env does not match provided storage account');
    throw new Error('Configured connection string in .env does not match provided storage account');
}
