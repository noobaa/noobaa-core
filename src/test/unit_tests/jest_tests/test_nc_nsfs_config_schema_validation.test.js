/* Copyright (C) 2024 NooBaa */
/* eslint-disable no-undef */

'use strict';

const nsfs_schema_utils = require('../../../manage_nsfs/nsfs_schema_utils');
const RpcError = require('../../../rpc/rpc_error');

describe('schema validation NC NSFS config', () => {

    describe('config with all needed properties', () => {

        it('nsfs_config - valid simple', () => {
            const config_data = {
                ALLOW_HTTP: true,
                NSFS_NC_STORAGE_BACKEND: 'GPFS',
                NSFS_NC_CONFIG_DIR_BACKEND: 'CEPH_FS',
                FORKS: 20,
                NSFS_DIR_CACHE_MAX_DIR_SIZE: 67108864,
                NSFS_DIR_CACHE_MAX_TOTAL_SIZE: 268435456,
            };
            nsfs_schema_utils.validate_nsfs_config_schema(config_data);
        });

        it('nsfs_config - recommendation', () => {
            const config_data = {
                ENDPOINT_PORT: 80,
                ENDPOINT_SSL_PORT: 443,
                ENDPOINT_FORKS: 16,
                UV_THREADPOOL_SIZE: 256,
                GPFS_DL_PATH: '/usr/lpp/mmfs/lib/libgpfs.so',
                NSFS_NC_STORAGE_BACKEND: 'GPFS',
                NSFS_NC_CONFIG_DIR_BACKEND: 'GPFS',
                NSFS_BUF_POOL_MEM_LIMIT: 4294967296,
                NSFS_BUF_SIZE: 16777216,
                NSFS_OPEN_READ_MODE: 'rd',
                NSFS_CHECK_BUCKET_BOUNDARIES: false,
                ALLOW_HTTP: true,
                NSFS_WHITELIST: [
                    '127.0.0.1',
                    '0000:0000:0000:0000:0000:ffff:7f00:0002',
                    '::ffff:7f00:3'
                ],
                NSFS_DIR_CACHE_MAX_DIR_SIZE: 268435456,
                NSFS_DIR_CACHE_MAX_TOTAL_SIZE: 805306368,
            };
            nsfs_schema_utils.validate_nsfs_config_schema(config_data);
        });

        it('nsfs_config - with a node', () => {
            const config_data = {
                ENDPOINT_FORKS: 2,
                    host_customization: [{
                        node_name: 'moti-mac',
                        ENDPOINT_FORKS: 3,
                    }, ],
            };
            nsfs_schema_utils.validate_nsfs_config_schema(config_data);
        });

        it('nsfs_config - with 2 nodes', () => {
            const config_data = {
                ENDPOINT_FORKS: 2,
                    host_customization: [
                        {
                            node_name: 'moti-mac',
                            ENDPOINT_FORKS: 3,
                        },
                        {
                            node_name: 'rafi-ubuntu',
                            ENDPOINT_FORKS: 4,
                        },
                    ],
            };
            nsfs_schema_utils.validate_nsfs_config_schema(config_data);
        });

    });

    describe('config with additional properties', () => {

        it('config with additional property MY_PATH', () => {
            const config_data = {
                ENDPOINT_FORKS: 2,
                    host_customization: [{
                        node_name: 'moti-mac',
                        ENDPOINT_FORKS: 3,
                        MY_PATH: '/usr/lpp/mmfs/lib/libgpfs.so' // example copied from above
                    }, ],
            };
            nsfs_schema_utils.validate_nsfs_config_schema(config_data);
        });

    });

    describe('config check default values', () => {

        it('on an empty config', () => {
            const config_data = { };
            nsfs_schema_utils.validate_nsfs_config_schema(config_data);
            // defaults
            expect(config_data).toHaveProperty('ENDPOINT_FORKS', 0);
            expect(config_data).toHaveProperty('ENDPOINT_PORT', 6001);
            expect(config_data).toHaveProperty('ENDPOINT_SSL_PORT', 6443);
            expect(config_data).toHaveProperty('ENDPOINT_SSL_STS_PORT', 7443);
            expect(config_data).toHaveProperty('EP_METRICS_SERVER_PORT', 7004);
            expect(config_data).toHaveProperty('ALLOW_HTTP', false);
            expect(config_data).toHaveProperty('NSFS_CALCULATE_MD5', false);
            expect(config_data).toHaveProperty('NOOBAA_LOG_LEVEL', 'default');
            expect(config_data).toHaveProperty('UV_THREADPOOL_SIZE', 4);
            expect(config_data).toHaveProperty('GPFS_DL_PATH', '');
            expect(config_data).toHaveProperty('NSFS_BUF_POOL_MEM_LIMIT', 33554432);
            expect(config_data).toHaveProperty('NSFS_BUF_SIZE', 8388608);
            expect(config_data).toHaveProperty('NSFS_OPEN_READ_MODE', 'r');
            expect(config_data).toHaveProperty('NSFS_CHECK_BUCKET_BOUNDARIES', true);
            expect(config_data).toHaveProperty('NSFS_TRIGGER_FSYNC', true);
            expect(config_data).toHaveProperty('NSFS_WHITELIST', []);
            expect(config_data).toHaveProperty('NSFS_DIR_CACHE_MAX_DIR_SIZE', 67108864);
            expect(config_data).toHaveProperty('NSFS_DIR_CACHE_MAX_TOTAL_SIZE', 268435456);
            expect(config_data).toHaveProperty('ENABLE_DEV_RANDOM_SEED', false);
        });

        it('config with different ENDPOINT_FORKS', () => {
            const config_data = {
                ENDPOINT_FORKS: 2,
            };
            nsfs_schema_utils.validate_nsfs_config_schema(config_data);
            // set in shared config file
            expect(config_data).toHaveProperty('ENDPOINT_FORKS', 2); // 2 was set default is 0
        });

        it('nsfs_config - with a node', () => {
            const config_data = {
                    host_customization: [{
                        node_name: 'moti-mac',
                        ENDPOINT_FORKS: 3,
                    }, ],
            };
            nsfs_schema_utils.validate_nsfs_config_schema(config_data);
            // default
            expect(config_data).toHaveProperty('ENDPOINT_FORKS', 0);
            // set in shared config file
            expect(config_data.host_customization[0]).toHaveProperty('ENDPOINT_FORKS', 3);
        });

    });

    describe('config with wrong types', () => {

        it('nsfs_config invalid ALLOW_HTTP', () => {
            const config_data = {
                ALLOW_HTTP: 123, // number instead of boolean
            };
            const reason = 'Test should have failed because of wrong type ' +
                'ALLOW_HTTP with number (instead of boolean)';
            const message = 'must be boolean';
            assert_validation(config_data, reason, message);
        });

        it('nsfs_config invalid forks', () => {
            const config_data = {
                ENDPOINT_FORKS: true, // boolean instead of number
            };
            const reason = 'Test should have failed because of wrong type ' +
                'ENDPOINT_FORKS with boolean (instead of number)';
            const message = 'must be number';
            assert_validation(config_data, reason, message);
        });

        it('nsfs_config invalid storage fs_backend', () => {
            const config_data = {
                NSFS_NC_STORAGE_BACKEND: 'INVALID_FS_BACKEND', // not part of definition of fs_backend
            };
            const reason = 'Test should have failed because of wrong type ' +
                'NSFS_NC_STORAGE_BACKEND with boolean (instead of number)';
            const message = 'must be equal to one of the allowed values';
            assert_validation(config_data, reason, message);
        });

        it('nsfs_config invalid config dir fs_backend', () => {
            const config_data = {
                NSFS_NC_CONFIG_DIR_BACKEND: 123, // number instead of string
            };
            const reason = 'Test should have failed because of wrong type ' +
                'NSFS_NC_CONFIG_DIR_BACKEND with number (instead of string)';
            const message = 'must be string';
            assert_validation(config_data, reason, message);
        });

        it('nsfs_config invalid config dir dir cache max dir size', () => {
            const config_data = {
                NSFS_DIR_CACHE_MAX_DIR_SIZE: 'not a number', // string instead of number
            };
            const reason = 'Test should have failed because of wrong type ' +
                'NSFS_DIR_CACHE_MAX_DIR_SIZE with number (instead of string)';
            const message = 'must be number';
            assert_validation(config_data, reason, message);
        });

        it('nsfs_config invalid config dir dir cache max total size', () => {
            const config_data = {
                NSFS_DIR_CACHE_MAX_TOTAL_SIZE: 'not a number', // string instead of number
            };
            const reason = 'Test should have failed because of wrong type ' +
                'NSFS_DIR_CACHE_MAX_TOTAL_SIZE with number (instead of string)';
            const message = 'must be number';
            assert_validation(config_data, reason, message);
        });

        it('nsfs_config invalid config disable random seed', () => {
            const config_data = {
                ENABLE_DEV_RANDOM_SEED: 'not boolean', // string instead of boolean
            };
            const reason = 'Test should have failed because of wrong type ' +
                'ENABLE_DEV_RANDOM_SEED with string (instead of boolean)';
            const message = 'must be boolean';
            assert_validation(config_data, reason, message);
        });
    });
});

function assert_validation(config_to_validate, reason, basic_message) {
    try {
        nsfs_schema_utils.validate_nsfs_config_schema(config_to_validate);
        fail(reason);
    } catch (err) {
        expect(err).toBeInstanceOf(RpcError);
        expect(err).toHaveProperty('message');
        expect((err.message).includes(basic_message)).toBeTruthy();
    }
}

// Jest has builtin function fail that based on Jasmine
// in case Jasmine would get removed from jest, created this one
// based on this: https://stackoverflow.com/a/55526098/16571658
function fail(reason) {
    throw new Error(reason);
}
