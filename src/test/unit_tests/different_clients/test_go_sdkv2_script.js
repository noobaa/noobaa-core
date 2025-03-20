/* Copyright (C) 2025 NooBaa */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = "true";

// setup coretest first to prepare the env
const coretest = require('../coretest');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[1]] });
const { rpc_client, EMAIL } = coretest;

const mocha = require('mocha');
const assert = require('assert');
const config = require('../../../../config');
const { run_go_sdk_v2_client_script } = require('./run_go_sdkv2_client_script');

mocha.describe('Go AWS SDK V2 Client script execution', function() {

    mocha.before(async () => {
        const account_info = await rpc_client.account.read_account({ email: EMAIL, });
        console.log('test_go_sdkv2_script: account_info', account_info);
        const admin_access_key = account_info.access_keys[0].access_key.unwrap();
        const admin_secret_key = account_info.access_keys[0].secret_key.unwrap();

        process.env.AWS_ACCESS_KEY_ID = admin_access_key;
        process.env.AWS_SECRET_ACCESS_KEY = admin_secret_key;
        process.env.AWS_DEFAULT_REGION = config.DEFAULT_REGION;
    });

    mocha.it('All test summary should pass (no failing tests)', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        try {
            const bucket_name = 'lala-bucket';
            const key_name = 'test-key';
            const mpu_key_name = 'test-mpu-key';
            const endpoint = coretest.get_http_address();
            console.log('test_go_sdkv2_script: endpoint', endpoint);

            const output = await run_go_sdk_v2_client_script(bucket_name, key_name, mpu_key_name, endpoint);
            console.log('\nTest output:\n');
            console.log(output);
            // here we will fail the test in case of at least one failing test printing
            const match_failing_tests_statement = output.match(/Failing Tests:\s*(\d+)/i);
            // we don't see the failing tests output we will set a number higher than 1 to fail the test on purpose
            const number_of_failing_tests = match_failing_tests_statement ? parseInt(match_failing_tests_statement[1], 10) : 1;
            assert.equal(number_of_failing_tests, 0);
        } catch (err) {
            console.log('error during the aws go client execution:', err);
            assert.fail(`test aws go client failed with: ${err}, ${err.stack}`);
        }
    });
});

