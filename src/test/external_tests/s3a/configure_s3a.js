/* Copyright (C) 2024 NooBaa */
"use strict";

const dbg = require('../../../util/debug_module')(__filename);
dbg.set_process_name('test_s3a');

const { S3A_TEST } = require('./s3a_constants');
const { is_containerized_deployment, create_system_test_account, create_system_test_bucket } = require('../external_tests_utils.js');

async function main() {
    try {
        await s3a_test_setup();
    } catch (err) {
        console.error(`S3A Setup Failed: ${err}`);
        process.exit(1);
    }
    process.exit(0);
}

async function s3a_test_setup() {
    console.info('S3A TEST CONFIGURATION:', JSON.stringify(S3A_TEST));
    const is_containerized = is_containerized_deployment();
    const account_options = is_containerized ? S3A_TEST.s3a_account_params : S3A_TEST.nc_s3a_account_params;
    
    // Create the test account
    await create_system_test_account(account_options);
    
    // Create the hadoop bucket
    const bucket_options = { name: S3A_TEST.bucket_name };
    await create_system_test_bucket(account_options, bucket_options);
    
    console.info('S3A TEST SETUP DONE');
}

if (require.main === module) {
    main();
}
