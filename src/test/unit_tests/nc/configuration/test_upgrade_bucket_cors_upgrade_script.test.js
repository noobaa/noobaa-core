/* Copyright (C) 2026 NooBaa */
'use strict';

const os = require('os');
const path = require('path');
const config = require('../../../../../config');
const dbg = require('../../../../util/debug_module')(__filename);
const { ConfigFS } = require('../../../../sdk/config_fs');
const fs_utils = require('../../../../util/fs_utils');
const nb_native = require('../../../../util/nb_native');
const native_fs_utils = require('../../../../util/native_fs_utils');
const { run, get_default_cors_configuration, upgrade_bucket_cors_config, upgrade_buckets_cors } =
    require('../../../../upgrade/nc_upgrade_scripts/1.1.0/upgrade_bucket_cors');

const TEST_TIMEOUT = 60 * 1000;
const tmp_fs_path = path.join(os.tmpdir(), 'test_upgrade_bucket_cors');
const config_root = path.join(tmp_fs_path, 'config_root');
const config_fs = new ConfigFS(config_root);

const default_cors = get_default_cors_configuration();
const custom_cors = [{
    allowed_origins: ['https://example.com'],
    allowed_methods: ['GET'],
    allowed_headers: ['*'],
    expose_headers: ['ETag'],
}];

function get_bucket_data(name, extra = {}) {
    return {
        _id: '65a62e22ceae5e5f1a758aa8' + name,
        name,
        owner_account: '65b3c68b59ab67b16f98c26e',
        versioning: 'DISABLED',
        creation_date: new Date('December 17, 2023 09:00:00').toISOString(),
        path: '/tmp/nsfs_root1',
        should_create_underlying_storage: true,
        ...extra,
    };
}

async function write_bucket_config_file(bucket_data) {
    const bucket_path = config_fs.get_bucket_path_by_name(bucket_data.name);
    await nb_native().fs.writeFile(
        config_fs.fs_context,
        bucket_path,
        Buffer.from(JSON.stringify(bucket_data)), {
            mode: native_fs_utils.get_umasked_mode(config.BASE_MODE_FILE)
        }
    );
}

describe('upgrade_bucket_cors NC upgrade script', () => {
    beforeEach(async () => {
        await fs_utils.create_fresh_path(config_fs.buckets_dir_path);
    });

    afterEach(async () => {
        await fs_utils.folder_delete(config_root);
    }, TEST_TIMEOUT);

    describe('upgrade_bucket_cors_config', () => {
        it('adds default CORS when the bucket has none', async () => {
            const bucket_data = get_bucket_data('bucket-no-cors');
            await write_bucket_config_file(bucket_data);
            await upgrade_bucket_cors_config(config_fs, bucket_data.name, dbg);
            const upgraded = await config_fs.get_bucket_by_name(bucket_data.name);
            expect(upgraded.cors_configuration_rules).toEqual(default_cors);
        });

        it('skips buckets that already have CORS configuration', async () => {
            const bucket_data = get_bucket_data('bucket-with-cors', { cors_configuration_rules: custom_cors });
            await write_bucket_config_file(bucket_data);
            await upgrade_bucket_cors_config(config_fs, bucket_data.name, dbg);
            const upgraded = await config_fs.get_bucket_by_name(bucket_data.name);
            expect(upgraded.cors_configuration_rules).toEqual(custom_cors);
        });

        it('skips missing buckets', async () => {
            await expect(upgrade_bucket_cors_config(config_fs, 'missing-bucket', dbg)).resolves.toBeUndefined();
        });
    });

    describe('upgrade_buckets_cors', () => {
        it('upgrades multiple buckets and preserves existing CORS', async () => {
            const bucket_without_cors = get_bucket_data('bucket-a');
            const bucket_with_cors = get_bucket_data('bucket-b', { cors_configuration_rules: custom_cors });
            await write_bucket_config_file(bucket_without_cors);
            await write_bucket_config_file(bucket_with_cors);

            const failed = await upgrade_buckets_cors(config_fs, [bucket_without_cors.name, bucket_with_cors.name], dbg);
            expect(failed).toEqual([]);

            const upgraded_a = await config_fs.get_bucket_by_name(bucket_without_cors.name);
            const upgraded_b = await config_fs.get_bucket_by_name(bucket_with_cors.name);
            expect(upgraded_a.cors_configuration_rules).toEqual(default_cors);
            expect(upgraded_b.cors_configuration_rules).toEqual(custom_cors);
        });

        it('returns an empty failed list when there are no buckets', async () => {
            const failed = await upgrade_buckets_cors(config_fs, [], dbg);
            expect(failed).toEqual([]);
        });
    });

    describe('run', () => {
        it('adds default CORS to all buckets without CORS', async () => {
            const bucket1 = get_bucket_data('bucket1');
            const bucket2 = get_bucket_data('bucket2');
            await write_bucket_config_file(bucket1);
            await write_bucket_config_file(bucket2);

            await run({ dbg, config_fs });

            const upgraded1 = await config_fs.get_bucket_by_name(bucket1.name);
            const upgraded2 = await config_fs.get_bucket_by_name(bucket2.name);
            expect(upgraded1.cors_configuration_rules).toEqual(default_cors);
            expect(upgraded2.cors_configuration_rules).toEqual(default_cors);
        });

        it('is idempotent when all buckets already have CORS', async () => {
            const bucket_data = get_bucket_data('bucket-already-upgraded', { cors_configuration_rules: default_cors });
            await write_bucket_config_file(bucket_data);
            await run({ dbg, config_fs });
            const upgraded = await config_fs.get_bucket_by_name(bucket_data.name);
            expect(upgraded.cors_configuration_rules).toEqual(default_cors);
        });

        it('succeeds when the buckets directory is missing', async () => {
            await fs_utils.folder_delete(config_fs.buckets_dir_path);
            await expect(run({ dbg, config_fs })).resolves.toBeUndefined();
        });

        it('succeeds when the buckets directory is empty', async () => {
            await expect(run({ dbg, config_fs })).resolves.toBeUndefined();
        });
    });
});
