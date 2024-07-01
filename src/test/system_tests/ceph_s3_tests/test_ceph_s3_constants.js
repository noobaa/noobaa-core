/* Copyright (C) 2022 NooBaa */
"use strict";

const CEPH_TEST = {
    test_dir: 'src/test/system_tests/ceph_s3_tests/',
    s3_test_dir: 's3-tests/',
    ceph_config: 'test_ceph_s3_config.conf',
    tox_config: 'tox.ini',
    new_account_params: {
        name: 'cephalt',
        email: 'ceph.alt@noobaa.com',
        has_login: false,
        s3_access: true,
    },
    new_account_params_tenant: {
        name: 'cephtenant',
        email: 'ceph.tenant@noobaa.com',
        has_login: false,
        s3_access: true,
    },
};

// For NSFS NC path (using default values)
const account_path = '/etc/noobaa.conf.d/root_accounts/cephalt.symlink';
const account_tenant_path = '/etc/noobaa.conf.d/root_accounts/cephtenant.symlink';
const anonymous_account_path = '/etc/noobaa.conf.d/root_accounts/anonymous.symlink';

const DEFAULT_NUMBER_OF_WORKERS = 5; //5 was the number of workers in the previous CI/CD process

const TOX_ARGS = `-c ${CEPH_TEST.test_dir}${CEPH_TEST.s3_test_dir}${CEPH_TEST.tox_config}`;

const AWS4_TEST_SUFFIX = '_aws4';

exports.CEPH_TEST = CEPH_TEST;
exports.account_path = account_path;
exports.anonymous_account_path = anonymous_account_path;
exports.account_tenant_path = account_tenant_path;
exports.DEFAULT_NUMBER_OF_WORKERS = DEFAULT_NUMBER_OF_WORKERS;
exports.TOX_ARGS = TOX_ARGS;
exports.AWS4_TEST_SUFFIX = AWS4_TEST_SUFFIX;
