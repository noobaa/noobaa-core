/* Copyright (C) 2024 NooBaa */
'use strict';

const SensitiveString = require('../../../util/sensitive_string');

const s3a_account_name = 's3a_account';

const S3A_MOCK_ACCESS_KEY = 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const S3A_MOCK_SECRET_KEY = 'YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY';

const S3A_TEST = {
    s3a_logs_dir_path: '/logs/s3a-test-logs',
    s3a_account_params: {
        name: s3a_account_name,
        email: 's3a_account@noobaa.com',
        has_login: true,
        password: 's3a_pass123_example',
        s3_access: true,
        allow_bucket_creation: true,
        access_keys: [{
            access_key: new SensitiveString(S3A_MOCK_ACCESS_KEY),
            secret_key: new SensitiveString(S3A_MOCK_SECRET_KEY)
        }]
    },
    nc_s3a_account_params: {
        name: s3a_account_name,
        uid: 1000,
        gid: 1000,
        new_buckets_path: '/tmp/nsfs_root_s3a/',
        access_key: S3A_MOCK_ACCESS_KEY,
        secret_key: S3A_MOCK_SECRET_KEY
    },
    bucket_name: 'hadoop',
    hadoop_version: '3.4.2',
    hadoop_dir: '/root/hadoop',
    hadoop_aws_dir: '/root/hadoop/hadoop-tools/hadoop-aws'
};

exports.S3A_TEST = S3A_TEST;
exports.S3A_MOCK_ACCESS_KEY = S3A_MOCK_ACCESS_KEY;
exports.S3A_MOCK_SECRET_KEY = S3A_MOCK_SECRET_KEY;
