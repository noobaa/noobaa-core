/* Copyright (C) 2022 NooBaa */
'use strict';

const warp_account_name = 'warp_account';
const warp_bucket_name = 'warp-benchmark-bucket';

// NC warp tests paths for bucket creation
const FS_ROOT_1 = '/tmp/nsfs_root1/';
const FS_ROOT_2 = '/tmp/nsfs_root2/';
const warp_nc_bucket_path = `${FS_ROOT_1}${warp_bucket_name}/`;

const WARP_TEST = {
    s3_test_dir: 's3-tests/',
    warp_logs_dir_path: '/logs/warp-test-logs',
    warp_account_params: {
        name: warp_account_name,
        email: 'warp_account@noobaa.com',
        has_login: true,
        password: 'warp_pass123',
        s3_access: true,
        allow_bucket_creation: true,
    },
    warp_bucket_params: {
        name: warp_bucket_name
    },
    nc_warp_account_params: {
        name: warp_account_name,
        uid: 1000,
        gid: 1000,
        new_buckets_path: FS_ROOT_1
    },
    nc_warp_bucket_params: {
        name: warp_bucket_name,
        owner: warp_account_name,
        path: warp_nc_bucket_path,
    },
    nc_anonymous_account_params: {
        anonymous: true,
        uid: process.getuid(),
        gid: process.getgid()
    }
};
const DEFAULT_NUMBER_OF_WORKERS = 5; // 5 was the number of workers in the previous CI/CD process

exports.WARP_TEST = WARP_TEST;
exports.DEFAULT_NUMBER_OF_WORKERS = DEFAULT_NUMBER_OF_WORKERS;
exports.FS_ROOT_1 = FS_ROOT_1;
exports.FS_ROOT_2 = FS_ROOT_2;

