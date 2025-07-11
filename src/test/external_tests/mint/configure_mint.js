/* Copyright (C) 2016 NooBaa */
"use strict";

const dbg = require('../../../util/debug_module')(__filename);
dbg.set_process_name('test_mint_s3');

const { MINT_TEST } = require('./mint_constants');
const { is_containerized_deployment, create_system_test_account } = require('../external_tests_utils.js');

async function main() {
    try {
        await mint_test_setup();
    } catch (err) {
        console.error(`Mint Setup Failed: ${err}`);
        process.exit(1);
    }
    process.exit(0);
}

async function mint_test_setup() {
    console.info('MINT TEST CONFIGURATION:', JSON.stringify(MINT_TEST));
    const is_containerized = is_containerized_deployment();
    const account_options = is_containerized ? MINT_TEST.mint_account_params : MINT_TEST.nc_mint_account_params;
    await create_system_test_account(account_options);
    console.info('MINT TEST SETUP DONE');
}

if (require.main === module) {
    main();
}

