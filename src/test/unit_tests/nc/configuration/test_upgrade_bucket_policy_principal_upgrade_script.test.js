/* Copyright (C) 2026 NooBaa */
'use strict';

const os = require('os');
const path = require('path');
const assert = require('assert');
const dbg = require('../../../../util/debug_module')(__filename);
const { ConfigFS, CONFIG_TYPES } = require('../../../../sdk/config_fs');
const fs_utils = require('../../../../util/fs_utils');
const access_policy_utils = require('../../../../util/access_policy_utils');
const { crypto_random_string } = require('../../../../util/string_utils');
const {
    TEST_TIMEOUT,
    write_manual_config_file,
} = require('../../../system_tests/test_utils');
const {
    run,
    bucket_policy_principals_need_upgrade,
    upgrade_buckets_policy_principal,
} = require('../../../../upgrade/nc_upgrade_scripts/1.2.0/upgrade_bucket_policy_principal');

const tmp_fs_path = path.join(__dirname, 'tmp_test_upgrade_bucket_policy_principal');
const config_root = path.join(tmp_fs_path, 'config_root');
const config = require('../../../../../config');
config.NC_MASTER_KEYS_FILE_LOCATION = path.join(config_root, 'master_keys.json');
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
            access_key: 'a-abcdefghijklmn123456EXAMPLE',
            secret_key: 's-abcdefghijklmn123456EXAMPLE',
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
            access_key: 'a-abcdefghijklmn123457EXAMPLE',
            secret_key: 's-abcdefghijklmn123457EXAMPLE',
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
            access_key: 'a-abcdefghijklmn123460EXAMPLE',
            secret_key: 's-abcdefghijklmn123460EXAMPLE',
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

function generate_bucket_policy_statement(principal, { not_principal = false } = {}) {
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

async function assert_scenario_principals(scenarios, label) {
    for (const [name, scenario] of Object.entries(scenarios)) {
        const upgraded = await config_fs.get_bucket_by_name(name);
        if (scenario.no_policy || scenario.expect_no_policy) {
            assert.strictEqual(upgraded.s3_policy, undefined, `${label} ${name}`);
            continue;
        }
        const principal_key = scenario.not_principal ? 'NotPrincipal' : 'Principal';
        if (scenario.expect_statement_count !== undefined) {
            assert.strictEqual(
                upgraded.s3_policy.Statement.length,
                scenario.expect_statement_count,
                `${label} ${name} statement count`,
            );
            if (Array.isArray(scenario.expect_aws) &&
                scenario.expect_aws.length === scenario.expect_statement_count) {
                scenario.expect_aws.forEach((expected, i) => {
                    const aws = upgraded.s3_policy.Statement[i][principal_key].AWS;
                    assert.deepStrictEqual(aws, expected, `${label} ${name} statement ${i}`);
                });
                continue;
            }
        }
        const statement_index = scenario.statement_index ?? 0;
        const aws = upgraded.s3_policy.Statement[statement_index][principal_key].AWS;
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
        await config_fs.create_account_config_file(iam_user);
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
            'bucket-arn-root': { policy: generate_bucket_policy_statement(other_arn), expect_aws: account_other._id },
            'bucket-name': { policy: generate_bucket_policy_statement(account_other.name), expect_aws: account_other._id },
            'bucket-id-stored': { policy: generate_bucket_policy_statement(account_other._id), expect_aws: account_other._id },
            'bucket-wildcard': { policy: generate_bucket_policy_statement('*'), expect_aws: '*' },
            'bucket-multi': {
                policy: generate_bucket_policy_statement([other_arn, account_root.name]),
                expect_aws: [account_other._id, account_root._id],
            },
            'bucket-not-principal': {
                policy: generate_bucket_policy_statement(other_arn, { not_principal: true }),
                expect_aws: account_other._id,
                not_principal: true,
            },
            'bucket-iam-user-arn': { policy: generate_bucket_policy_statement(iam_user_arn), expect_aws: iam_user._id },
            'bucket-invalid-arn': {
                policy: generate_bucket_policy_statement(invalid_arn),
                expect_no_policy: true,
            },
            'bucket-multi-partial': {
                policy: generate_bucket_policy_statement([other_arn, invalid_arn]),
                expect_aws: account_other._id,
            },
            'bucket-multi-all-invalid': {
                policy: generate_bucket_policy_statement([invalid_arn, invalid_arn]),
                expect_no_policy: true,
            },
            'bucket-multi-statement-drop-one': {
                policy: {
                    Version: '2012-10-17',
                    Statement: [
                        ...generate_bucket_policy_statement(other_arn).Statement,
                        ...generate_bucket_policy_statement(account_root.name).Statement,
                        ...generate_bucket_policy_statement(invalid_arn).Statement,
                    ],
                },
                expect_statement_count: 2,
                expect_aws: [account_other._id, account_root._id],
            },
            'bucket-no-policy': { no_policy: true },
        };

        for (const [name, scenario] of Object.entries(scenarios)) {
            const bucket_data = get_bucket_data(name, scenario.policy);
            if (scenario.no_policy) delete bucket_data.s3_policy;
            await write_manual_config_file(CONFIG_TYPES.BUCKET, config_fs, bucket_data);
        }

        assert.strictEqual(bucket_policy_principals_need_upgrade(generate_bucket_policy_statement(other_arn)), true);
        assert.strictEqual(bucket_policy_principals_need_upgrade(generate_bucket_policy_statement(account_other._id)), true);
        assert.strictEqual(bucket_policy_principals_need_upgrade(generate_bucket_policy_statement('*')), false);

        const bucket_names = await config_fs.list_buckets();
        const first_pass = await upgrade_buckets_policy_principal(config_fs, bucket_names, dbg);
        assert.strictEqual(first_pass.failed_buckets.length, 0);
        assert.strictEqual(first_pass.updated_buckets_count, bucket_names.length);

        await assert_scenario_principals(scenarios, 'after upgrade');

        await run({ dbg, config_fs });

        const second_pass = await upgrade_buckets_policy_principal(config_fs, bucket_names, dbg);
        assert.strictEqual(second_pass.updated_buckets_count, bucket_names.length);
        assert.strictEqual(second_pass.failed_buckets.length, 0);

        await assert_scenario_principals(scenarios, 'idempotent');
    });

    it('completes when the buckets directory is missing', async () => {
        await fs_utils.folder_delete(config_fs.buckets_dir_path);
        await run({ dbg, config_fs });
    });
});
