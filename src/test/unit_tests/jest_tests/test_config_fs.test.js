/* Copyright (C) 2024 NooBaa */
'use strict';

const os = require('os');
const path = require('path');
const config = require('../../../../config');
const pkg = require('../../../../package.json');
const { TMP_PATH } = require('../../system_tests/test_utils');
const { get_process_fs_context } = require('../../../util/native_fs_utils');
const { ConfigFS } = require('../../../sdk/config_fs');

const tmp_fs_path = path.join(TMP_PATH, 'test_config_fs');
const config_root = path.join(tmp_fs_path, 'config_root');
const config_root_backend = config.NSFS_NC_CONFIG_DIR_BACKEND;
const fs_context = get_process_fs_context(config_root_backend);

const config_fs = new ConfigFS(config_root, config_root_backend, fs_context);

describe('adjust_bucket_with_schema_updates', () => {
    it('should return undefined on undefined bucket', () => {
        const bucket = undefined;
        config_fs.adjust_bucket_with_schema_updates(bucket);
        expect(bucket).toBeUndefined();
    });

    it('should return bucket without deprecated properties', () => {
        const bucket = {name: 'bucket1', system_owner: 'account1-system-owner', bucket_owner: 'account1-bucket_owner'};
        config_fs.adjust_bucket_with_schema_updates(bucket);
        expect(bucket).toBeDefined();
        expect(bucket).not.toHaveProperty('system_owner');
        expect(bucket).not.toHaveProperty('bucket_owner');
    });
});

describe('_get_new_hostname_data', () => {
    it('_get_new_hostname_data - happy path', () => {
        const new_hostname_data = config_fs._get_new_hostname_data();
        expect(new_hostname_data).toStrictEqual({
            [os.hostname()]: {
                current_version: pkg.version,
                config_dir_version: config_fs.config_dir_version,
                upgrade_history: {
                    successful_upgrades: []
                },
            }
        });
    });
});

describe('compare_host_and_config_dir_version', () => {
    it('running code config_dir_version equals to system.json config_dir_version', () => {
        const running_code_config_dir_version = '0.0.0';
        const system_config_dir_version = '0.0.0';
        const ver_compare_err = config_fs.compare_host_and_config_dir_version(running_code_config_dir_version, system_config_dir_version);
        expect(ver_compare_err).toBeUndefined();
    });

    it('running code config_dir_version higher than system.json config_dir_version', () => {
        const running_code_config_dir_version = '1.0.0';
        const system_config_dir_version = '0.0.0';
        const ver_compare_err = config_fs.compare_host_and_config_dir_version(running_code_config_dir_version, system_config_dir_version);
        expect(ver_compare_err).toBe(`running code config_dir_version=${running_code_config_dir_version} is higher than the config dir version ` +
                `mentioned in system.json=${system_config_dir_version}, any updates to the config directory are blocked until the config dir upgrade`);
    });

    it('running code config_dir_version lower than system.json config_dir_version', () => {
        const running_code_config_dir_version = '0.0.0';
        const system_config_dir_version = '1.0.0';
        const ver_compare_err = config_fs.compare_host_and_config_dir_version(running_code_config_dir_version, system_config_dir_version);
        expect(ver_compare_err).toBe(`running code config_dir_version=${running_code_config_dir_version} is lower than the config dir version ` +
                `mentioned in system.json=${system_config_dir_version}, any updates to the config directory are blocked until the source code upgrade`);
    });
});
