/* Copyright (C) 2016 NooBaa */
"use strict";

const dbg = require('../../../util/debug_module')(__filename);
dbg.set_process_name('test_warp_s3');

const { WARP_TEST } = require('./warp_constants.js');
const { is_containerized_deployment, create_system_test_account, create_system_test_bucket } = require('../external_tests_utils.js');

async function main() {
    try {
        await warp_test_setup();
    } catch (err) {
        console.error(`Warp Setup Failed: ${err}`);
        process.exit(1);
    }
    process.exit(0);
}

async function warp_test_setup() {
    console.info('WARP TEST CONFIGURATION:', JSON.stringify(WARP_TEST));
    const is_containerized = is_containerized_deployment();
    const account_options = is_containerized ? WARP_TEST.warp_account_params : WARP_TEST.nc_warp_account_params;
    const bucket_options = is_containerized ? WARP_TEST.warp_bucket_params : WARP_TEST.nc_warp_bucket_params;
    await create_system_test_account(account_options);
    await create_system_test_bucket(account_options, bucket_options);
    console.info('WARP TEST SETUP DONE');
}

if (require.main === module) {
    main();
}


