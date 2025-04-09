/* Copyright (C) 2024 NooBaa */
'use strict';

const path = require('path');
const mocha = require('mocha');
const assert = require('assert');
const fs_utils = require('../../util/fs_utils');
const { TYPES, ACTIONS } = require('../../manage_nsfs/manage_nsfs_constants');
const { TMP_PATH, set_path_permissions_and_owner, invalid_nsfs_root_permissions, generate_s3_client, get_coretest_path,
    generate_lifecycle_rule, validate_expiration_header, update_file_mtime, exec_manage_cli } = require('../system_tests/test_utils');

const coretest_path = get_coretest_path();
const coretest = require(coretest_path);
const { rpc_client, EMAIL, get_admin_mock_account_details } = coretest;
coretest.setup({});

let s3_admin;

const tmp_fs_root = path.join(TMP_PATH, 'test_nc_lifecycle_expiration/');

/**
 * is_nc_coretest returns true when the test runs on NC env
 */
const is_nc_coretest = process.env.NC_CORETEST === 'true';

mocha.describe('nc lifecycle - check expiration header', async function() {
    const bucket_path = path.join(tmp_fs_root, 'test-bucket/');
    const bucket_name = 'test-bucket';

    mocha.before(async function() {
        this.timeout(0); // eslint-disable-line no-invalid-this
        if (invalid_nsfs_root_permissions()) this.skip(); // eslint-disable-line no-invalid-this
        // create paths
        await fs_utils.create_fresh_path(tmp_fs_root, 0o777);
        await fs_utils.create_fresh_path(bucket_path, 0o770);
        await fs_utils.file_must_exist(bucket_path);

        // set permissions
        if (is_nc_coretest) {
            const { uid, gid } = get_admin_mock_account_details();
            await set_path_permissions_and_owner(bucket_path, { uid, gid }, 0o700);
        }

        // create s3_admin client
        const admin = (await rpc_client.account.read_account({ email: EMAIL, }));
        const admin_keys = admin.access_keys;
        s3_admin = generate_s3_client(admin_keys[0].access_key.unwrap(),
                        admin_keys[0].secret_key.unwrap(),
                        coretest.get_http_address());

        // create test bucket
        const cli_bucket_options = {
            name: bucket_name,
            owner: admin.name,
            path: bucket_path,
        };
        await exec_manage_cli(TYPES.BUCKET, ACTIONS.ADD, cli_bucket_options);
    });

    mocha.after(async function() {
        this.timeout(0); // eslint-disable-line no-invalid-this
        fs_utils.folder_delete(tmp_fs_root);
    });

    const run_expiration_test = async ({ rules, expected_id, expected_days, key, tagging = undefined, size = 1000}) => {
        const putLifecycleParams = {
            Bucket: bucket_name,
            LifecycleConfiguration: { Rules: rules }
        };
        await s3_admin.putBucketLifecycleConfiguration(putLifecycleParams);

        const putObjectParams = {
            Bucket: bucket_name,
            Key: key,
            Body: 'x'.repeat(size) // default 1KB if size not specified
        };
        if (tagging) {
            putObjectParams.Tagging = tagging;
        }
        const start_time = new Date();
        let res = await s3_admin.putObject(putObjectParams);
        assert.ok(res.Expiration, 'expiration header missing in putObject response');

        // update file mtime to simulate a 5-days old object
        await update_file_mtime(path.join(bucket_path, key));

        res = await s3_admin.headObject({ Bucket: bucket_name, Key: key });
        assert.ok(res.Expiration, 'expiration header missing in headObject response');

        const valid = validate_expiration_header(res.Expiration, start_time, expected_id, expected_days - 5);
        assert.ok(valid, `expected rule ${expected_id} to match`);
    };

    mocha.it('should select rule with longest prefix', async () => {
        const rules = [
            generate_lifecycle_rule(10, 'short-prefix', 'lifecycle-test1/', [], undefined, undefined),
            generate_lifecycle_rule(17, 'long-prefix', 'lifecycle-test1/logs/', [], undefined, undefined),
        ];
        await run_expiration_test({
            rules,
            key: 'lifecycle-test1/logs//file.txt',
            expected_id: 'long-prefix',
            expected_days: 17
        });
    });

    mocha.it('should select rule with more tags when prefix is same', async () => {
        const rules = [
            generate_lifecycle_rule(5, 'one-tag', 'lifecycle-test2/', [{ Key: 'env', Value: 'prod' }], undefined, undefined),
            generate_lifecycle_rule(9, 'two-tags', 'lifecycle-test2/', [
                { Key: 'env', Value: 'prod' },
                { Key: 'team', Value: 'backend' }
            ], undefined, undefined),
        ];
        await run_expiration_test({
            rules,
            key: 'lifecycle-test2/file2.txt',
            tagging: 'env=prod&team=backend',
            expected_id: 'two-tags',
            expected_days: 9
        });
    });

    mocha.it('should select rule with narrower size span when prefix and tags are matching', async () => {
        const rules = [
            generate_lifecycle_rule(4, 'wide-range', 'lifecycle-test3/', [], 100, 10000),
            generate_lifecycle_rule(6, 'narrow-range', 'lifecycle-test3/', [], 1000, 5000),
        ];
        await run_expiration_test({
            rules,
            key: 'lifecycle-test3/file3.txt',
            size: 1500,
            expected_id: 'narrow-range',
            expected_days: 6
        });
    });

    mocha.it('should fallback to first matching rule if all filters are equal', async () => {
        const rules = [
            generate_lifecycle_rule(7, 'rule-a', 'lifecycle/test4/', [], 0, 10000),
            generate_lifecycle_rule(11, 'rule-b', 'lifecycle/test4/', [], 0, 10000),
        ];
        await run_expiration_test({
            rules,
            key: 'lifecycle/test4/file4.txt',
            expected_id: 'rule-a',
            expected_days: 7
        });
    });
});
