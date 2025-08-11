/* Copyright (C) 2022 NooBaa */
"use strict";

const cephalt_name = 'cephalt';
const cephtenant_name = 'cephtenant';

// NC ceph tests paths for bucket creation
const FS_ROOT_1 = '/tmp/nsfs_root1/';
const FS_ROOT_2 = '/tmp/nsfs_root2/';

const CEPH_TEST = {
    test_dir: 'src/test/external_tests/ceph_s3_tests/',
    s3_test_dir: 's3-tests/',
    ceph_config: 'test_ceph_s3_config.conf',
    tox_config: 'tox.ini',
    new_account_params: {
        name: cephalt_name,
        email: 'ceph.alt@noobaa.com',
        has_login: false,
        s3_access: true,
    },
    new_account_params_tenant: {
        name: cephtenant_name,
        email: 'ceph.tenant@noobaa.com',
        has_login: false,
        s3_access: true,
    },
    nc_cephalt_account_params: {
        name: cephalt_name,
        uid: 1000,
        gid: 1000,
        new_buckets_path: FS_ROOT_1
    },
    nc_cephtenant_account_params: {
        name: cephtenant_name,
        uid: 2000,
        gid: 2000,
        new_buckets_path: FS_ROOT_2
    },
    nc_anonymous_account_params: {
        anonymous: true,
        uid: process.getuid(),
        gid: process.getgid()
    },
    ns_aws_cephalt_account_config: {
        uid: 1000,
        gid: 1000,
        new_buckets_path: '/tmp/ns_aws_ceph_alt',
        nsfs_only: false
    },
    ns_aws_cephtenant_account_config: {
        uid: 2000,
        gid: 2000,
        new_buckets_path: '/tmp/ns_aws_ceph_tenant',
        nsfs_only: false
    }
};
const DEFAULT_NUMBER_OF_WORKERS = 5; //5 was the number of workers in the previous CI/CD process

const TOX_ARGS = `-c ${CEPH_TEST.test_dir}${CEPH_TEST.s3_test_dir}${CEPH_TEST.tox_config}`;

const AWS4_TEST_SUFFIX = '_aws4';

exports.CEPH_TEST = CEPH_TEST;
exports.DEFAULT_NUMBER_OF_WORKERS = DEFAULT_NUMBER_OF_WORKERS;
exports.TOX_ARGS = TOX_ARGS;
exports.AWS4_TEST_SUFFIX = AWS4_TEST_SUFFIX;
exports.FS_ROOT_1 = FS_ROOT_1;
exports.FS_ROOT_2 = FS_ROOT_2;

