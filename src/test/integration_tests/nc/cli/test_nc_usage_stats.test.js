/* Copyright (C) 2026 NooBaa */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = 'true';

const fs = require('fs');
const path = require('path');
const fs_utils = require('../../../../util/fs_utils');
const nb_native = require('../../../../util/nb_native');
const { ConfigFS, SYMLINK_SUFFIX } = require('../../../../sdk/config_fs');
const { TYPES, ACTIONS, DIAGNOSE_ACTIONS } = require('../../../../manage_nsfs/manage_nsfs_constants');
const { ManageCLIResponse } = require('../../../../manage_nsfs/manage_nsfs_cli_responses');
const {
    TMP_PATH,
    TEST_TIMEOUT,
    exec_manage_cli,
    set_nc_config_dir_in_config,
    set_path_permissions_and_owner,
    generate_s3_policy,
} = require('../../../system_tests/test_utils');

const tmp_fs_path = path.join(TMP_PATH, 'test_nc_usage_stats');
const config_root = path.join(tmp_fs_path, 'config_root');
const root_path = path.join(tmp_fs_path, 'root_path');
const config_fs = new ConfigFS(config_root);
const process_uid = process.getuid();
const process_gid = process.getgid();

describe('noobaa cli - diagnose usage-stats', () => {
    const account_defaults = {
        name: 'usage_stats_account',
        new_buckets_path: path.join(root_path, 'new_buckets_path'),
        uid: process_uid,
        gid: process_gid,
        access_key: 'GIGiFAnjaaE7OKD5N7hX',
        secret_key: 'G2AYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE',
        allow_bucket_creation: 'true',
    };

    const account_iam_manager = {
        name: 'usage_stats_iam_mgr',
        new_buckets_path: path.join(root_path, 'new_buckets_path_iam'),
        uid: process_uid,
        gid: process_gid,
        access_key: 'GIGiFAnjaaE7OKD5N8hY',
        secret_key: 'G3BYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE',
        iam_operate_on_root_account: 'true',
    };

    const bucket_plain_path = path.join(root_path, 'bucket_plain');
    const bucket_featured_path = path.join(root_path, 'bucket_featured');

    beforeAll(async () => {
        await fs_utils.folder_delete(tmp_fs_path);
        await fs_utils.create_fresh_path(root_path);
        await fs_utils.create_fresh_path(config_root);
        set_nc_config_dir_in_config(config_root);

        for (const account of [account_defaults, account_iam_manager]) {
            await fs_utils.create_fresh_path(account.new_buckets_path);
            await set_path_permissions_and_owner(account.new_buckets_path, account, 0o700);
            const account_res = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, { config_root, ...account });
            expect(JSON.parse(account_res).response.code).toBe('AccountCreated');
        }

        const anon_res = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, {
            config_root,
            anonymous: true,
            uid: process_uid,
            gid: process_gid,
        });
        expect(JSON.parse(anon_res).response.code).toBe('AccountCreated');

        await fs_utils.create_fresh_path(bucket_plain_path);
        await fs_utils.create_fresh_path(bucket_featured_path);
        await exec_manage_cli(TYPES.BUCKET, ACTIONS.ADD, {
            config_root,
            name: 'bucket-plain',
            owner: account_defaults.name,
            path: bucket_plain_path,
        });
        await exec_manage_cli(TYPES.BUCKET, ACTIONS.ADD, {
            config_root,
            name: 'bucket-featured',
            owner: account_defaults.name,
            path: bucket_featured_path,
            force_md5_etag: 'true',
            bucket_policy: JSON.stringify(generate_s3_policy('*', 'bucket-featured', ['s3:*']).policy),
        });

        const featured_bucket = await config_fs.get_bucket_by_name('bucket-featured');
        featured_bucket.versioning = 'ENABLED';
        featured_bucket.lifecycle_configuration_rules = [
            {
                id: 'rule1',
                status: 'Enabled',
                filter: { prefix: '' },
                expiration: { days: 30 },
            },
            {
                id: 'rule2',
                status: 'Enabled',
                filter: { prefix: 'logs/' },
                expiration: { days: 7 },
            },
            {
                id: 'rule3',
                status: 'Disabled',
                filter: { prefix: 'tmp/' },
                expiration: { days: 1 },
            },
        ];
        featured_bucket.notifications = [
            {
                id: ['notif1'],
                event: ['s3:ObjectCreated:*'],
                topic: ['conn1'],
            },
            {
                id: ['notif2'],
                event: ['s3:ObjectRemoved:*'],
                topic: ['conn1'],
            },
        ];
        featured_bucket.logging = {
            log_bucket: 'bucket-plain',
            log_prefix: 'logs/',
        };
        featured_bucket.encryption = {
            algorithm: 'AES256',
        };
        featured_bucket.website = {
            website_configuration: {
                index_document: { suffix: 'index.html' },
            },
        };
        featured_bucket.cors_configuration_rules = [
            {
                allowed_origins: ['*'],
                allowed_methods: ['GET'],
            },
            {
                allowed_origins: ['https://example.com'],
                allowed_methods: ['PUT', 'POST'],
            },
        ];
        featured_bucket.object_lock_configuration = {
            object_lock_enabled: 'Enabled',
        };
        featured_bucket.public_access_block = {
            block_public_acls: true,
        };
        featured_bucket.tag = [{ key: 'env', value: 'test' }];
        await config_fs.update_bucket_config_file(featured_bucket);

        const suspended_path = path.join(root_path, 'bucket_suspended');
        await fs_utils.create_fresh_path(suspended_path);
        await exec_manage_cli(TYPES.BUCKET, ACTIONS.ADD, {
            config_root,
            name: 'bucket-suspended',
            owner: account_defaults.name,
            path: suspended_path,
        });
        const suspended_bucket = await config_fs.get_bucket_by_name('bucket-suspended');
        suspended_bucket.versioning = 'SUSPENDED';
        suspended_bucket.lifecycle_configuration_rules = [{
            id: 'rule1',
            status: 'Enabled',
            filter: { prefix: '' },
            expiration: { days: 90 },
        }];
        await config_fs.update_bucket_config_file(suspended_bucket);

        const connection_file = path.join(tmp_fs_path, 'conn1.json');
        await fs.promises.writeFile(connection_file, JSON.stringify({
            name: 'conn1',
            notification_protocol: 'http',
            agent_request_object: { host: 'localhost', port: 9999, timeout: 100 },
            request_options_object: { auth: 'user:passw' },
        }));
        await exec_manage_cli(TYPES.CONNECTION, ACTIONS.ADD, {
            config_root,
            from_file: connection_file,
        });

        const account = await config_fs.get_account_by_name(account_defaults.name);
        await config_fs.create_users_dir_if_missing(account._id);
        const users_dir = config_fs.get_users_dir_path_by_id(account._id);
        await nb_native().fs.symlink(
            config_fs.fs_context,
            '../../dummy_user_identity',
            path.join(users_dir, `iam-user-1${SYMLINK_SUFFIX}`)
        );
        await nb_native().fs.symlink(
            config_fs.fs_context,
            '../../dummy_user_identity',
            path.join(users_dir, `iam-user-2${SYMLINK_SUFFIX}`)
        );
    }, TEST_TIMEOUT);

    afterAll(async () => {
        await fs_utils.folder_delete(tmp_fs_path);
    }, TEST_TIMEOUT);

    it('diagnose usage-stats returns aggregate counts', async () => {
        const res = await exec_manage_cli(TYPES.DIAGNOSE, DIAGNOSE_ACTIONS.USAGE_STATS, { config_root });
        console.log(res);
        const parsed = JSON.parse(res);
        expect(parsed.response.code).toBe(ManageCLIResponse.UsageStats.code);

        const reply = parsed.response.reply;
        expect(reply.noobaa_version).toBeDefined();
        expect(reply.config_dir_version).toBeDefined();
        expect(reply.collected_at).toBeDefined();
        expect(typeof reply.hosts_count).toBe('number');

        expect(reply.accounts).toEqual({
            total: 3,
            anonymous: 1,
            root_account_managers: 1,
            with_allow_bucket_creation: 2,
            with_default_connection: 0,
            with_users: 1,
        });

        expect(reply.users).toEqual({
            total: 2,
        });

        expect(reply.buckets.total).toBe(3);
        expect(reply.buckets.features).toEqual({
            versioning_enabled: 1,
            versioning_suspended: 1,
            lifecycle: 2,
            notifications: 1,
            logging: 1,
            bucket_policy: 1,
            encryption: 1,
            website: 1,
            cors: 1,
            object_lock: 1,
            public_access_block: 1,
            tags: 1,
            force_md5_etag: 1,
            lifecycle_top10_rules: [3, 1],
            notifications_top10_rules: [2],
            cors_top10_rules: [2],
            bucket_policy_top10_statements: [1],
        });

        expect(reply.connections).toEqual({
            total: 1,
            by_protocol: { http: 1 },
        });

        // Aggregate-only: no resource names should appear in the reply payload.
        const reply_str = JSON.stringify(reply);
        expect(reply_str).not.toContain(account_defaults.name);
        expect(reply_str).not.toContain('bucket-featured');
        expect(reply_str).not.toContain(account_defaults.access_key);
        expect(reply_str).not.toContain(account_defaults.secret_key);
    }, TEST_TIMEOUT);
});
