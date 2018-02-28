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
    process.exit(1);
}

let isStringFound = false;
_.each(process.env, envKey => {
    if (envKey.includes(argv.storage)) {
        process.env.AZURE_STORAGE_CONNECTION_STRING = envKey;
        isStringFound = true;
    }
});

if (!isStringFound) {
    console.error('Configured connection string in .env does not match provided storage account');
    process.exit(1);
}
