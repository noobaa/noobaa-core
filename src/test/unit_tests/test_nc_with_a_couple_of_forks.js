/* Copyright (C) 2024 NooBaa */
'use strict';

const path = require('path');
const _ = require('lodash');
const P = require('../../util/promise');
const mocha = require('mocha');
const assert = require('assert');
const fs_utils = require('../../util/fs_utils');
const { TMP_PATH, generate_nsfs_account, get_new_buckets_path_by_test_env, generate_s3_client, get_coretest_path } = require('../system_tests/test_utils');

const coretest_path = get_coretest_path();
const coretest = require(coretest_path);
const setup_options = { forks: 2, debug: 5 };
coretest.setup(setup_options);
const { rpc_client, EMAIL, get_current_setup_options, stop_nsfs_process, start_nsfs_process } = coretest;

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
});
