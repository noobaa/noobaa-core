/* Copyright (C) 2024 NooBaa */
'use strict';

const path = require('path');
const config = require('../../../../config');
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

    it('should return bucket without deprecated properties (system_owner)', () => {
        const bucket = {name: 'bucket1', system_owner: 'account1-system-owner'};
        config_fs.adjust_bucket_with_schema_updates(bucket);
        expect(bucket).toBeDefined();
        expect(bucket).not.toHaveProperty('system_owner');
    });
});
