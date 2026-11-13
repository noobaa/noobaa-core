/* Copyright (C) 2026 NooBaa */
'use strict';

const os = require('os');
const path = require('path');
const assert = require('assert');
const dbg = require('../../../../util/debug_module')(__filename);
const { ConfigFS, CONFIG_TYPES } = require('../../../../sdk/config_fs');
const fs_utils = require('../../../../util/fs_utils');
const nb_native = require('../../../../util/nb_native');
const access_policy_utils = require('../../../../util/access_policy_utils');
const { crypto_random_string } = require('../../../../util/string_utils');
const {
    TEST_TIMEOUT,
    write_manual_config_file,
    create_identity_dir_if_missing,
} = require('../../../system_tests/test_utils');
const {
    run,
    bucket_policy_principals_need_upgrade,
    upgrade_buckets_policy_principal,
    upgrade_bucket_policy_principal_config,
} = require('../../../../upgrade/nc_upgrade_scripts/1.2.0/upgrade_bucket_policy_principal');

const tmp_fs_path = path.join(__dirname, 'tmp_test_upgrade_bucket_policy_principal');
const config_root = path.join(tmp_fs_path, 'config_root');
const config_fs = new ConfigFS(config_root);

let account_root;
let account_other;
let iam_user;

function init_test_identities() {
    const suffix = crypto_random_string(10);

    account_root = {
        _id: '65a8edc9bc5d5bbf9db71b91',
        name: `root-account-${suffix}`,
        email: `root-${suffix}@noobaa.io`,
        identity_type: 'ACCOUNT',
        allow_bucket_creation: true,
        access_keys: [{
            access_key: 'a-abcdefghijklmn123456',
            secret_key: 's-abcdefghijklmn123456',
        }],
        nsfs_account_config: { uid: 0, gid: 0 },
        creation_date: '2023-10-30T04:46:33.815Z',
    };

    account_other = {
        _id: '65a8edc9bc5d5bbf9db71b92',
        name: `other-account-${suffix}`,
        email: `other-${suffix}@noobaa.io`,
        identity_type: 'ACCOUNT',
        allow_bucket_creation: true,
        access_keys: [{
            access_key: 'a-abcdefghijklmn123457',
            secret_key: 's-abcdefghijklmn123457',
        }],
        nsfs_account_config: { uid: 0, gid: 0 },
        creation_date: '2023-10-30T04:46:33.815Z',
    };

    iam_user = {
        _id: '65a8edc9bc5d5bbf9db71b95',
        name: `iam-user-${suffix}`,
        email: `iam-user-${suffix}@noobaa.io`,
        identity_type: 'USER',
        owner: account_other._id,
        allow_bucket_creation: false,
        access_keys: [{
            access_key: 'a-abcdefghijklmn123460',
            secret_key: 's-abcdefghijklmn123460',
        }],
        nsfs_account_config: { uid: 0, gid: 0 },
        creation_date: '2023-11-30T04:46:33.815Z',
    };
}

let bucket_id_seq = 0;

function get_bucket_data(name, s3_policy) {
    bucket_id_seq += 1;
    return {
        _id: `65a62e22ceae5e5f1a758${String(bucket_id_seq).padStart(3, '0')}`,
        name,
        owner_account: account_root._id,
        versioning: 'DISABLED',
        creation_date: new Date('December 17, 2023 09:00:00').toISOString(),
        path: path.join(os.tmpdir(), 'bucket_path', name),
        should_create_underlying_storage: false,
        s3_policy,
    };
}

function policy_stmt(principal, { not_principal = false } = {}) {
    const key = not_principal ? 'NotPrincipal' : 'Principal';
    return {
        Version: '2012-10-17',
        Statement: [{
            Sid: 's1',
            Effect: 'Allow',
            [key]: { AWS: principal },
            Action: ['s3:GetObject'],
            Resource: ['arn:aws:s3:::bucket/*'],
        }],
    };
}

async function write_iam_user(config_fs_param, user_data) {
    const owner_id = user_data.owner;
    await fs_utils.create_fresh_path(config_fs_param.get_users_dir_path_by_id(owner_id));
    await create_identity_dir_if_missing(config_fs_param, user_data._id);
    const identity_path = config_fs_param.get_identity_path_by_id(user_data._id);
    await nb_native().fs.writeFile(
        config_fs_param.fs_context,
        identity_path,
        Buffer.from(JSON.stringify(user_data)),
        { mode: 0o644 }
    );
    const link_target = config_fs_param.get_user_relative_path_by_id(user_data._id);
    const user_symlink_path = config_fs_param.get_user_path_by_name(user_data.name, owner_id);
    await nb_native().fs.symlink(config_fs_param.fs_context, link_target, user_symlink_path);
}

async function write_bucket(bucket_data) {
    await write_manual_config_file(CONFIG_TYPES.BUCKET, config_fs, bucket_data);
}

async function assert_scenario_principals(scenarios, label) {
    for (const [name, scenario] of Object.entries(scenarios)) {
        const upgraded = await config_fs.get_bucket_by_name(name);
        if (scenario.no_policy) {
            assert.strictEqual(upgraded.s3_policy, undefined, `${label} ${name}`);
            continue;
        }
        const principal_key = scenario.not_principal ? 'NotPrincipal' : 'Principal';
        const aws = upgraded.s3_policy.Statement[0][principal_key].AWS;
        assert.deepStrictEqual(aws, scenario.expect_aws, `${label} ${name}`);
    }
}

describe('upgrade_bucket_policy_principal NC upgrade script', () => {
    beforeEach(async () => {
        bucket_id_seq = 0;
        init_test_identities();
        await fs_utils.create_fresh_path(config_root);
        await fs_utils.create_fresh_path(config_fs.identities_dir_path);
        await fs_utils.create_fresh_path(config_fs.accounts_by_name_dir_path);
        await fs_utils.create_fresh_path(config_fs.access_keys_dir_path);
        await fs_utils.create_fresh_path(config_fs.buckets_dir_path);
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, config_fs, account_root);
        await write_manual_config_file(CONFIG_TYPES.ACCOUNT, config_fs, account_other);
        await write_iam_user(config_fs, iam_user);
    });

    afterEach(async () => {
        await fs_utils.folder_delete(config_root);
    }, TEST_TIMEOUT);

    /**
     * Run: npx mocha src/test/unit_tests/nc/configuration/test_upgrade_bucket_policy_principal_upgrade_script.test.js
     */
    it('all principal upgrade scenarios in one run()', async () => {
        const other_arn = access_policy_utils.create_arn_for_root(account_other._id);
        const iam_user_arn = access_policy_utils.create_arn_for_user(account_other._id, iam_user.name);
        const invalid_arn = access_policy_utils.create_arn_for_user(account_other._id, 'missing-user');

        const scenarios = {
            'bucket-arn-root': { policy: policy_stmt(other_arn), expect_aws: account_other._id },
            'bucket-name': { policy: policy_stmt(account_other.name), expect_aws: account_other._id },
            'bucket-id-stored': { policy: policy_stmt(account_other._id), expect_aws: account_other._id },
            'bucket-wildcard': { policy: policy_stmt('*'), expect_aws: '*' },
            'bucket-multi': {
                policy: policy_stmt([other_arn, account_root.name]),
                expect_aws: [account_other._id, account_root._id],
            },
            'bucket-not-principal': {
                policy: policy_stmt(other_arn, { not_principal: true }),
                expect_aws: account_other._id,
                not_principal: true,
            },
            'bucket-iam-user-arn': { policy: policy_stmt(iam_user_arn), expect_aws: iam_user._id },
            'bucket-invalid-arn': { policy: policy_stmt(invalid_arn), expect_aws: invalid_arn },
            'bucket-no-policy': { no_policy: true },
        };

        for (const [name, scenario] of Object.entries(scenarios)) {
            const bucket_data = get_bucket_data(name, scenario.policy);
            if (scenario.no_policy) delete bucket_data.s3_policy;
            await write_bucket(bucket_data);
        }

        assert.strictEqual(bucket_policy_principals_need_upgrade(policy_stmt(other_arn)), true);
        assert.strictEqual(bucket_policy_principals_need_upgrade(policy_stmt(account_other._id)), false);
        assert.strictEqual(bucket_policy_principals_need_upgrade(policy_stmt('*')), false);

        const bucket_names = await config_fs.list_buckets();
        const first_pass = await upgrade_buckets_policy_principal(config_fs, bucket_names, dbg);
        assert.deepStrictEqual(first_pass.failed_buckets, []);
        assert.strictEqual(first_pass.updated_count, 5);
        assert.deepStrictEqual([...first_pass.skipped_buckets].sort(), [
            'bucket-id-stored',
            'bucket-invalid-arn',
            'bucket-no-policy',
            'bucket-wildcard',
        ].sort());

        await assert_scenario_principals(scenarios, 'after upgrade');

        const missing = await upgrade_bucket_policy_principal_config(config_fs, 'bucket-does-not-exist', dbg);
        assert.deepStrictEqual(missing, { updated: false, skipped: true });

        const invalid_config = await upgrade_bucket_policy_principal_config(config_fs, 'bucket-invalid-arn', dbg);
        assert.deepStrictEqual(invalid_config, { updated: false, skipped: true });

        await run({ dbg, config_fs });

        const second_pass = await upgrade_buckets_policy_principal(config_fs, bucket_names, dbg);
        assert.strictEqual(second_pass.updated_count, 0);
        assert.strictEqual(second_pass.failed_buckets.length, 0);

        await assert_scenario_principals(scenarios, 'idempotent');
    });

    it('completes when the buckets directory is missing', async () => {
        await fs_utils.folder_delete(config_fs.buckets_dir_path);
        await run({ dbg, config_fs });
    });
});
