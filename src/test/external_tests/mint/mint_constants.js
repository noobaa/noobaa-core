/* Copyright (C) 2022 NooBaa */
'use strict';

const SensitiveString = require('../../../util/sensitive_string');

const mint_account_name = 'mint_account';

// NC mint tests paths for bucket creation
const FS_ROOT_1 = '/tmp/nsfs_root1/';
const FS_ROOT_2 = '/tmp/nsfs_root2/';
const MINT_MOCK_ACCESS_KEY = 'aaaaaaaaaaaaaEXAMPLE';
const MINT_MOCK_SECRET_KEY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaEXAMPLE';

const MINT_TEST = {
    s3_test_dir: 's3-tests/',
    mint_logs_dir_path: '/logs/mint-test-logs',
    mint_account_params: {
        name: mint_account_name,
        email: 'mint_account@noobaa.com',
        has_login: true,
        password: 'mint_pass123_example',
        s3_access: true,
        allow_bucket_creation: true,
        access_keys: [{
            access_key: new SensitiveString(MINT_MOCK_ACCESS_KEY),
            secret_key: new SensitiveString(MINT_MOCK_SECRET_KEY)
        }]
    },
    nc_mint_account_params: {
        name: mint_account_name,
        uid: 1000,
        gid: 1000,
        new_buckets_path: FS_ROOT_1,
        access_key: MINT_MOCK_ACCESS_KEY,
        secret_key: MINT_MOCK_SECRET_KEY
    },
    nc_anonymous_account_params: {
        anonymous: true,
        uid: process.getuid(),
        gid: process.getgid()
    }
};

exports.MINT_TEST = MINT_TEST;
exports.FS_ROOT_1 = FS_ROOT_1;
exports.FS_ROOT_2 = FS_ROOT_2;

