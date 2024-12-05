/* Copyright (C) 2024 NooBaa */
/* eslint-disable max-statements */
'use strict';

const path = require('path');
const _ = require('lodash');
const fs = require('fs');
const P = require('../../util/promise');
const mocha = require('mocha');
const assert = require('assert');
const fs_utils = require('../../util/fs_utils');
const { TMP_PATH, generate_nsfs_account, get_new_buckets_path_by_test_env, generate_s3_client,
    get_coretest_path, exec_manage_cli } = require('../system_tests/test_utils');
const { TYPES, ACTIONS } = require('../../manage_nsfs/manage_nsfs_constants');
const ManageCLIResponse = require('../../manage_nsfs/manage_nsfs_cli_responses').ManageCLIResponse;

const coretest_path = get_coretest_path();
const coretest = require(coretest_path);
const setup_options = { forks: 2, debug: 5 };
coretest.setup(setup_options);
const { rpc_client, EMAIL, get_current_setup_options, stop_nsfs_process, start_nsfs_process, config_dir_name } = coretest;

const CORETEST_ENDPOINT = coretest.get_http_address();

const config_root = path.join(TMP_PATH, 'test_nc_cache_stat');
// on NC - new_buckets_path is full absolute path
// on Containerized - new_buckets_path is the directory
const new_bucket_path_param = get_new_buckets_path_by_test_env(config_root, '/');

const bucket_name = 'bucket1';
let s3_admin;

mocha.describe('operations with a couple of forks', async function() {
    this.timeout(50000); // eslint-disable-line no-invalid-this
    const bucket_path = path.join(TMP_PATH, 'bucket1');

    mocha.before(async () => {
        // we want to make sure that we run this test with a couple of forks (by default setup it is 0)
        const current_setup_options = get_current_setup_options();
        const same_setup = _.isEqual(current_setup_options, setup_options);
        if (!same_setup) {
            console.log('current_setup_options', current_setup_options, 'same_setup', same_setup);
            await stop_nsfs_process();
            await start_nsfs_process(setup_options);
        }

        await fs_utils.create_fresh_path(bucket_path);
        await fs_utils.file_must_exist(bucket_path);
        const res = await generate_nsfs_account(rpc_client, EMAIL, new_bucket_path_param, { admin: true });
        s3_admin = generate_s3_client(res.access_key, res.secret_key, CORETEST_ENDPOINT);
    });

    mocha.after(async () => {
        fs_utils.folder_delete(`${config_root}`);
    });

    mocha.it('versioning change with a couple of forks', async function() {
        const res_bucket_create = await s3_admin.createBucket({ Bucket: bucket_name });
        assert.equal(res_bucket_create.$metadata.httpStatusCode, 200);

        // 1 request for bucket versioning enabled (can be handled by any of the forks)
        await s3_admin.putBucketVersioning({ Bucket: bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } });

        // a couple of requests for get bucket versioning
        const failed_operations = [];
        const successful_operations = [];
        const num_of_concurrency = 10;
        for (let i = 0; i < num_of_concurrency; i++) {
            s3_admin.getBucketVersioning({ Bucket: bucket_name })
                .catch(err => failed_operations.push(err))
                .then(res => successful_operations.push(res));
        }
        await P.delay(2000);
        assert.equal(successful_operations.length, num_of_concurrency);
        assert.equal(failed_operations.length, 0);
        const all_res_with_enabled = successful_operations.every(res => res.Status === 'Enabled');
        assert.ok(all_res_with_enabled);

        // cleanup
       await s3_admin.deleteBucket({ Bucket: bucket_name });
    });

    mocha.it('list buckets after regenerate access keys', async function() {
        // create additional account
        const account_name = 'James';
        const account_options_create = { account_name, uid: 5, gid: 5, config_root: config_dir_name };
        await fs_utils.create_fresh_path(new_bucket_path_param);
        await fs.promises.chown(new_bucket_path_param, account_options_create.uid, account_options_create.gid);
        await fs.promises.chmod(new_bucket_path_param, 0o700);
        const access_details = await generate_nsfs_account(rpc_client, EMAIL, new_bucket_path_param, account_options_create);
        // check the account status
        const account_options_status = { config_root: config_dir_name, name: account_name};
        const res_account_status = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.STATUS, account_options_status);
        assert.equal(JSON.parse(res_account_status).response.code, ManageCLIResponse.AccountStatus.code);
        // generate the s3 client
        const s3_uid5_before_access_keys_update = generate_s3_client(access_details.access_key,
            access_details.secret_key, CORETEST_ENDPOINT);
        // check the connection for the new account (can be any of the forks)
        const res_list_buckets = await s3_uid5_before_access_keys_update.listBuckets({});
        assert.equal(res_list_buckets.$metadata.httpStatusCode, 200);
        // create a bucket
        const bucket_name2 = 'bucket2';
        const res_bucket_create = await s3_uid5_before_access_keys_update.createBucket({ Bucket: bucket_name2 });
        assert.equal(res_bucket_create.$metadata.httpStatusCode, 200);
        // update the account
        const account_options_update = { config_root: config_dir_name, name: account_name, regenerate: true};
        const res_account_update = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.UPDATE, account_options_update);
        const access_key_id_updated = JSON.parse(res_account_update).response.reply.access_keys[0].access_key;
        const secret_key_updated = JSON.parse(res_account_update).response.reply.access_keys[0].secret_key;
        const s3_uid5_after_access_keys_update = generate_s3_client(access_key_id_updated,
            secret_key_updated, CORETEST_ENDPOINT);
        // check the connection for the updated access keys account (can be any of the forks)
        const res_list_buckets3 = await s3_uid5_after_access_keys_update.listBuckets({});
        assert.equal(res_list_buckets3.$metadata.httpStatusCode, 200);

        // a couple of requests with the previous access keys (all should failed)
        // without checking the stat the expiry is OBJECT_SDK_ACCOUNT_CACHE_EXPIRY_MS
        let failed_operations = 0;
        let successful_operations = 0;
        const number_of_requests = 5;
        for (let i = 0; i < number_of_requests; i++) {
            try {
                await s3_uid5_before_access_keys_update.listBuckets({});
                successful_operations += 1;
            } catch (err) {
                failed_operations += 1;
            }
        }
        assert.equal(successful_operations, 0);
        assert.equal(failed_operations, number_of_requests);

        // a couple of requests with the updated access keys (all should success)
        let failed_operations2 = 0;
        let successful_operations2 = 0;
        const number_of_requests2 = 5;
        for (let i = 0; i < number_of_requests2; i++) {
            try {
                await s3_uid5_after_access_keys_update.listBuckets({});
                successful_operations2 += 1;
            } catch (err) {
                failed_operations2 += 1;
            }
        }
        assert.equal(successful_operations2, number_of_requests2);
        assert.equal(failed_operations2, 0);

        // cleanup
        await s3_uid5_after_access_keys_update.deleteBucket({ Bucket: bucket_name2 });
    });
});
