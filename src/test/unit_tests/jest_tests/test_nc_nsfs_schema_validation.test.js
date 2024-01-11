/* Copyright (C) 2024 NooBaa */
/* eslint-disable no-undef */
/*eslint max-lines-per-function: ["error", 800]*/

'use strict';

const nsfs_schema_utils = require('../../../manage_nsfs/nsfs_schema_utils');
const RpcError = require('../../../rpc/rpc_error');
const test_utils = require('../../system_tests/test_utils');

// function that we use to make sure that we are in the catch clause
// it would fail the test
function throw_error_in_case_error_was_not_thrown() {
    throw new Error('Test passed instead of failed');
}

describe('schema validation NC NSFS account', () => {
    const account_name = 'account1';
    const account_email = 'account1@noobaa.io';
    const access_key = 'GIGiFAnjaaE7OKD5N7hA';
    const secret_key = 'U2AYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE';
    const creation_date = new Date('December 17, 2023 09:00:00').toISOString();
    const nsfs_account_config_uid_gid = {
        uid: 1001,
        gid: 1001,
    };
    const nsfs_account_config_distinguished_name = {
        distinguished_name: 'moti-1003',
    };
    const new_bucket_path = '/tmp/nsfs_root1';

    describe('account with all needed properties', () => {

        it('nsfs_account_config with uid, gid', () => {
            const account_data = {
                name: account_name,
                email: account_email,
                access_keys: [
                    {
                        access_key: access_key,
                        secret_key: secret_key
                    },
                ],
                nsfs_account_config: {
                    ...nsfs_account_config_uid_gid
                },
                creation_date: creation_date,
                allow_bucket_creation: true,
            };
            nsfs_schema_utils.validate_account_schema(account_data);
        });

        it('nsfs_account_config with distinguished_name', () => {
            const account_data = {
                name: account_name,
                email: account_email,
                access_keys: [
                    {
                        access_key: access_key,
                        secret_key: secret_key
                    },
                ],
                nsfs_account_config: {
                    ...nsfs_account_config_distinguished_name
                },
                creation_date: creation_date,
                allow_bucket_creation: true,
            };
            nsfs_schema_utils.validate_account_schema(account_data);
        });

        it('nsfs_account_config with fs_backend', () => {
            const account_data = {
                name: account_name,
                email: account_email,
                access_keys: [
                    {
                        access_key: access_key,
                        secret_key: secret_key
                    },
                ],
                nsfs_account_config: {
                    ...nsfs_account_config_uid_gid,
                    fs_backend: 'GPFS' // added
                },
                creation_date: creation_date,
                allow_bucket_creation: true,
            };
            nsfs_schema_utils.validate_account_schema(account_data);
        });

        it('nsfs_account_config with new_bucket_path', () => {
            const account_data = {
                name: account_name,
                email: account_email,
                access_keys: [
                    {
                        access_key: access_key,
                        secret_key: secret_key
                    },
                ],
                nsfs_account_config: {
                    ...nsfs_account_config_uid_gid,
                    new_buckets_path: new_bucket_path //added
                },
                creation_date: creation_date,
                allow_bucket_creation: true,
            };
            nsfs_schema_utils.validate_account_schema(account_data);
        });

    });

    describe('account with additional properties', () => {

        it('nsfs_account_config with distinguished_name AND uid gid', () => {
            const account_data = {
                name: account_name,
                email: account_email,
                access_keys: [
                    {
                        access_key: access_key,
                        secret_key: secret_key
                    },
                ],
                nsfs_account_config: {
                    // here we use both uid gid and distinguished_name
                    ...nsfs_account_config_uid_gid,
                    ...nsfs_account_config_distinguished_name
                },
                creation_date: creation_date,
                allow_bucket_creation: true,
            };
            try {
                nsfs_schema_utils.validate_account_schema(account_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', 'must NOT have additional properties');
            }
        });

        it('account with new_name', () => {
            const account_data = {
                name: account_name,
                new_name: 'account2', // this is not part of the schema
                email: account_email,
                access_keys: [
                    {
                        access_key: access_key,
                        secret_key: secret_key
                    },
                ],
                nsfs_account_config: {
                    ...nsfs_account_config_uid_gid,
                },
                creation_date: creation_date,
                allow_bucket_creation: true,
            };
            try {
                nsfs_schema_utils.validate_account_schema(account_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', 'must NOT have additional properties');
            }
        });

        // note: it is new_access_key (and not new_access_keys in the code)
        it('account with new_access_key', () => {
            const account_data = {
                name: account_name,
                email: account_email,
                access_keys: [
                    {
                        access_key: access_key,
                        secret_key: secret_key
                    },
                ],
                // this is not part of the schema
                new_access_key: [
                    {
                        access_key: access_key,
                        secret_key: secret_key
                    },
                ],
                nsfs_account_config: {
                    ...nsfs_account_config_uid_gid,
                },
                creation_date: creation_date,
                allow_bucket_creation: true,
            };
            try {
                nsfs_schema_utils.validate_account_schema(account_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', 'must NOT have additional properties');
            }
        });

        it('account with duration_seconds inside access_keys', () => {
            const account_data = {
                name: account_name,
                email: account_email,
                access_keys: [
                    {
                        access_key: access_key,
                        secret_key: secret_key,
                        duration_seconds: 3600, // this is not part of the schema
                    },
                ],
                nsfs_account_config: {
                    ...nsfs_account_config_uid_gid,
                },
                creation_date: creation_date,
                allow_bucket_creation: true,
            };
            try {
                nsfs_schema_utils.validate_account_schema(account_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', 'must NOT have additional properties');
            }
        });

        it('account with my_id inside nsfs_account_config', () => {
            const account_data = {
                name: account_name,
                email: account_email,
                access_keys: [
                    {
                        access_key: access_key,
                        secret_key: secret_key,
                    },
                ],
                nsfs_account_config: {
                    ...nsfs_account_config_uid_gid,
                    my_id: 123, // this is not part of the schema
                },
                creation_date: creation_date,
                allow_bucket_creation: true,
            };
            try {
                nsfs_schema_utils.validate_account_schema(account_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', 'must NOT have additional properties');
            }
        });

    });

    // note: had to use " " (double quotes) instead of ' ' (single quotes) to match the message
    describe('account without required properties', () => {

        it('account without name', () => {
            const account_data = {
                // name: account_name, // hide it on purpose
                email: account_email,
                access_keys: [
                    {
                        access_key: access_key,
                        secret_key: secret_key
                    },
                ],
                nsfs_account_config: {
                    ...nsfs_account_config_uid_gid,
                },
                creation_date: creation_date,
                allow_bucket_creation: true,
            };
            try {
                nsfs_schema_utils.validate_account_schema(account_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', "must have required property 'name'");
            }
        });

        it('account with undefined name', () => {
            const account_data = {
                name: undefined, // on purpose
                email: account_email,
                access_keys: [
                    {
                        access_key: access_key,
                        secret_key: secret_key
                    },
                ],
                nsfs_account_config: {
                    ...nsfs_account_config_uid_gid,
                },
                creation_date: creation_date,
                allow_bucket_creation: true,
            };
            try {
                nsfs_schema_utils.validate_account_schema(account_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', "must have required property 'name'");
            }
        });

        it('account without email', () => {
            const account_data = {
                name: account_name,
                // email: account_email, // hide it on purpose
                access_keys: [
                    {
                        access_key: access_key,
                        secret_key: secret_key
                    },
                ],
                nsfs_account_config: {
                    ...nsfs_account_config_uid_gid,
                },
                creation_date: creation_date,
                allow_bucket_creation: false,
            };
            try {
                nsfs_schema_utils.validate_account_schema(account_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', "must have required property 'email'");
            }
        });

        it('account with undefined email', () => {
            const account_data = {
                name: account_name,
                email: undefined, // on purpose
                access_keys: [
                    {
                        access_key: access_key,
                        secret_key: secret_key
                    },
                ],
                nsfs_account_config: {
                    ...nsfs_account_config_uid_gid,
                },
                creation_date: creation_date,
                allow_bucket_creation: false,
            };
            try {
                nsfs_schema_utils.validate_account_schema(account_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', "must have required property 'email'");
            }
        });

        it('account without access_keys', () => {
            const account_data = {
                name: account_name,
                email: account_email,
                // access_keys: [ // hide it on purpose
                //     {
                //         access_key: access_key,
                //         secret_key: secret_key
                //     },
                // ],
                nsfs_account_config: {
                    ...nsfs_account_config_uid_gid,
                },
                creation_date: creation_date,
                allow_bucket_creation: false,
            };
            try {
                nsfs_schema_utils.validate_account_schema(account_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', "must have required property 'access_keys'");
            }
        });

        it('account with undefined access_keys', () => {
            const account_data = {
                name: account_name,
                email: account_email,
                access_keys: undefined, // on purpose
                nsfs_account_config: {
                    ...nsfs_account_config_uid_gid,
                },
                creation_date: creation_date,
                allow_bucket_creation: false,
            };
            try {
                nsfs_schema_utils.validate_account_schema(account_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', "must have required property 'access_keys'");
            }
        });

        it('account without access_keys details (access_key and secret_key)', () => {
            const account_data = {
                name: account_name,
                email: account_email,
                access_keys: [
                    {
                    // hide it on purpose
                //         access_key: access_key,
                //         secret_key: secret_key
                    },
                ],
                nsfs_account_config: {
                    ...nsfs_account_config_uid_gid,
                },
                creation_date: creation_date,
                allow_bucket_creation: false,
            };
            try {
                nsfs_schema_utils.validate_account_schema(account_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', "must have required property 'access_key'");
            }
        });

        it('account without access_key', () => {
            const account_data = {
                name: account_name,
                email: account_email,
                access_keys: [
                    {
                //         access_key: access_key, // hide it on purpose
                        secret_key: secret_key
                    },
                ],
                nsfs_account_config: {
                    ...nsfs_account_config_uid_gid,
                },
                creation_date: creation_date,
                allow_bucket_creation: false,
            };
            try {
                nsfs_schema_utils.validate_account_schema(account_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', "must have required property 'access_key'");
            }
        });

        it('account with undefined access_key', () => {
            const account_data = {
                name: account_name,
                email: account_email,
                access_keys: [
                    {
                        access_key: undefined, // on purpose
                        secret_key: secret_key
                    },
                ],
                nsfs_account_config: {
                    ...nsfs_account_config_uid_gid,
                },
                creation_date: creation_date,
                allow_bucket_creation: false,
            };
            try {
                nsfs_schema_utils.validate_account_schema(account_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', "must have required property 'access_key'");
            }
        });

        it('account without secret_key', () => {
            const account_data = {
                name: account_name,
                email: account_email,
                access_keys: [
                    {
                        access_key: access_key,
                        // secret_key: secret_key // hide it on purpose
                    },
                ],
                nsfs_account_config: {
                    ...nsfs_account_config_uid_gid,
                },
                creation_date: creation_date,
                allow_bucket_creation: false,
            };
            try {
                nsfs_schema_utils.validate_account_schema(account_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', "must have required property 'secret_key'");
            }
        });

        it('account with undefined secret_key', () => {
            const account_data = {
                name: account_name,
                email: account_email,
                access_keys: [
                    {
                        access_key: access_key,
                        secret_key: undefined // on purpose
                    },
                ],
                nsfs_account_config: {
                    ...nsfs_account_config_uid_gid,
                },
                creation_date: creation_date,
                allow_bucket_creation: false,
            };
            try {
                nsfs_schema_utils.validate_account_schema(account_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', "must have required property 'secret_key'");
            }
        });

        it('account without nsfs_account_config', () => {
            const account_data = {
                name: account_name,
                email: account_email,
                access_keys: [
                    {
                        access_key: access_key,
                        secret_key: secret_key
                    },
                ],
                // nsfs_account_config: { // hide it on purpose
                //     ...nsfs_account_config_uid_gid,
                // },
                creation_date: creation_date,
                allow_bucket_creation: false,
            };
            try {
                nsfs_schema_utils.validate_account_schema(account_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message',
                    "must have required property 'nsfs_account_config'");
            }
        });

        it('account with undefined nsfs_account_config', () => {
            const account_data = {
                name: account_name,
                email: account_email,
                access_keys: [
                    {
                        access_key: access_key,
                        secret_key: secret_key
                    },
                ],
                nsfs_account_config: undefined, // on purpose
                creation_date: creation_date,
                allow_bucket_creation: false,
            };
            try {
                nsfs_schema_utils.validate_account_schema(account_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message',
                    "must have required property 'nsfs_account_config'");
            }
        });

        it('account without nsfs_account_config details (uid gid or distinguished_name)', () => {
            const account_data = {
                name: account_name,
                email: account_email,
                access_keys: [
                    {
                        access_key: access_key,
                        secret_key: secret_key
                    },
                ],
                nsfs_account_config: {
                //     ...nsfs_account_config_uid_gid, // hide it on purpose
                },
                creation_date: creation_date,
                allow_bucket_creation: false,
            };
            try {
                nsfs_schema_utils.validate_account_schema(account_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', "must have required property 'uid'");
            }
        });

        it('account without creation_date', () => {
            const account_data = {
                name: account_name,
                email: account_email,
                access_keys: [
                    {
                        access_key: access_key,
                        secret_key: secret_key
                    },
                ],
                nsfs_account_config: {
                    ...nsfs_account_config_uid_gid,
                },
                // creation_date: creation_date, // hide it on purpose
                allow_bucket_creation: false,
            };
            try {
                nsfs_schema_utils.validate_account_schema(account_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message',
                    "must have required property 'creation_date'");
            }
        });

        it('account with undefined creation_date', () => {
            const account_data = {
                name: account_name,
                email: account_email,
                access_keys: [
                    {
                        access_key: access_key,
                        secret_key: secret_key
                    },
                ],
                nsfs_account_config: {
                    ...nsfs_account_config_uid_gid,
                },
                creation_date: undefined, // on purpose
                allow_bucket_creation: false,
            };
            try {
                nsfs_schema_utils.validate_account_schema(account_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message',
                    "must have required property 'creation_date'");
            }
        });

        it('account without allow_bucket_creation', () => {
            const account_data = {
                name: account_name,
                email: account_email,
                access_keys: [
                    {
                        access_key: access_key,
                        secret_key: secret_key
                    },
                ],
                nsfs_account_config: {
                    ...nsfs_account_config_uid_gid,
                },
                creation_date: creation_date,
                // allow_bucket_creation: false, // hide it on purpose
            };
            try {
                nsfs_schema_utils.validate_account_schema(account_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message',
                    "must have required property 'allow_bucket_creation'");
            }
        });

        it('account with undefined allow_bucket_creation', () => {
            const account_data = {
                name: account_name,
                email: account_email,
                access_keys: [
                    {
                        access_key: access_key,
                        secret_key: secret_key
                    },
                ],
                nsfs_account_config: {
                    ...nsfs_account_config_uid_gid,
                },
                creation_date: creation_date,
                allow_bucket_creation: undefined, // on purpose
            };
            try {
                nsfs_schema_utils.validate_account_schema(account_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message',
                    "must have required property 'allow_bucket_creation'");
            }
        });

    });

    describe('account with wrong types', () => {

        it('nsfs_account_config with uid, gid as boolean (instead of number)', () => {
            const account_data = {
                name: account_name,
                email: account_email,
                access_keys: [
                    {
                        access_key: access_key,
                        secret_key: secret_key
                    },
                ],
                nsfs_account_config: {
                    // boolean instead of number
                    uid: false,
                    gid: false,
                },
                creation_date: creation_date,
                allow_bucket_creation: true,
            };
            try {
                nsfs_schema_utils.validate_account_schema(account_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', 'must be number');
            }
        });

        it('nsfs_account_config with creation_date as Date (instead of string)', () => {
            const account_data = {
                name: account_name,
                email: account_email,
                access_keys: [
                    {
                        access_key: access_key,
                        secret_key: secret_key
                    },
                ],
                nsfs_account_config: {
                    ...nsfs_account_config_uid_gid,
                },
                creation_date: Date.now(), // Date instead of string
                allow_bucket_creation: true,
            };
            try {
                nsfs_schema_utils.validate_account_schema(account_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', 'must be string');
            }
        });

        it('nsfs_account_config with fs_backend not part of enum', () => {
            const account_data = {
                name: account_name,
                email: account_email,
                access_keys: [
                    {
                        access_key: access_key,
                        secret_key: secret_key
                    },
                ],
                nsfs_account_config: {
                    ...nsfs_account_config_uid_gid,
                    fs_backend: '' // not part of definition of fs_backend
                },
                creation_date: creation_date,
                allow_bucket_creation: true,
            };
            try {
                nsfs_schema_utils.validate_account_schema(account_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', 'must be equal to one of the allowed values');
            }
        });

    });

});

describe('schema validation NC NSFS bucket', () => {
    const bucket_name = 'bucket1';
    const system_owner = 'account1@noobaa.io';
    const bucket_owner = 'account1@noobaa.io';
    const versioning_disabled = 'DISABLED';
    const versioning_enabled = 'ENABLED';
    const creation_date = new Date('December 17, 2023 09:00:00').toISOString();
    const path = '/tmp/nsfs_root1';
    const bucket_policy = test_utils.generate_s3_policy('*', bucket_name, ['s3:*']).policy;

    describe('account with all needed properties', () => {

        it('nsfs_bucket', () => {
            const bucket_data = {
                name: bucket_name,
                system_owner: system_owner,
                bucket_owner: bucket_owner,
                versioning: versioning_disabled,
                creation_date: creation_date,
                path: path,
                should_create_underlying_storage: true,
            };
            nsfs_schema_utils.validate_bucket_schema(bucket_data);
        });

        it('nsfs_bucket with tag', () => {
            const bucket_data = {
                name: bucket_name,
                system_owner: system_owner,
                bucket_owner: bucket_owner,
                versioning: versioning_enabled,
                creation_date: creation_date,
                path: path,
                should_create_underlying_storage: true,
                tag: 'myTag', // added
            };
            nsfs_schema_utils.validate_bucket_schema(bucket_data);
        });

        it('nsfs_bucket with fs_backend', () => {
            const bucket_data = {
                name: bucket_name,
                system_owner: system_owner,
                bucket_owner: bucket_owner,
                versioning: versioning_disabled,
                creation_date: creation_date,
                path: path,
                should_create_underlying_storage: true,
                fs_backend: 'CEPH_FS', // added
            };
            nsfs_schema_utils.validate_bucket_schema(bucket_data);
        });

        it('nsfs_bucket with s3_policy (bucket policy)', () => {
            const bucket_data = {
                name: bucket_name,
                system_owner: system_owner,
                bucket_owner: bucket_owner,
                versioning: versioning_disabled,
                creation_date: creation_date,
                path: path,
                should_create_underlying_storage: false,
                s3_policy: bucket_policy, // added
            };
            nsfs_schema_utils.validate_bucket_schema(bucket_data);
        });

    });

    describe('bucket with additional properties', () => {

        it('bucket with new_name', () => {
            const bucket_data = {
                name: bucket_name,
                new_name: 'bucket', // this is not part of the schema
                system_owner: system_owner,
                bucket_owner: bucket_owner,
                versioning: versioning_disabled,
                creation_date: creation_date,
                path: path,
                should_create_underlying_storage: false,
            };
            try {
                nsfs_schema_utils.validate_bucket_schema(bucket_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', 'must NOT have additional properties');
            }
        });

    });

    // note: had to use " " (double quotes) instead of ' ' (single quotes) to match the message
    describe('bucket without required properties', () => {

        it('bucket without name', () => {
            const bucket_data = {
                // name: bucket_name, // hide it on purpose
                system_owner: system_owner,
                bucket_owner: bucket_owner,
                versioning: versioning_disabled,
                creation_date: creation_date,
                path: path,
                should_create_underlying_storage: false,
            };
            try {
                nsfs_schema_utils.validate_bucket_schema(bucket_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', "must have required property 'name'");
            }
        });

        it('bucket with undefined name', () => {
            const bucket_data = {
                name: undefined, // on purpose
                system_owner: system_owner,
                bucket_owner: bucket_owner,
                versioning: versioning_disabled,
                creation_date: creation_date,
                path: path,
                should_create_underlying_storage: false,
            };
            try {
                nsfs_schema_utils.validate_bucket_schema(bucket_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', "must have required property 'name'");
            }
        });

        it('bucket without system_owner', () => {
            const bucket_data = {
                name: bucket_name,
                // system_owner: system_owner, // hide it on purpose
                bucket_owner: bucket_owner,
                versioning: versioning_disabled,
                creation_date: creation_date,
                path: path,
                should_create_underlying_storage: false,
            };
            try {
                nsfs_schema_utils.validate_bucket_schema(bucket_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', "must have required property 'system_owner'");
            }
        });

        it('bucket with undefined system_owner', () => {
            const bucket_data = {
                name: bucket_name,
                system_owner: undefined, // on purpose
                bucket_owner: bucket_owner,
                versioning: versioning_disabled,
                creation_date: creation_date,
                path: path,
                should_create_underlying_storage: false,
            };
            try {
                nsfs_schema_utils.validate_bucket_schema(bucket_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', "must have required property 'system_owner'");
            }
        });

        it('bucket without bucket_owner', () => {
            const bucket_data = {
                name: bucket_name,
                system_owner: system_owner,
                // bucket_owner: bucket_owner, // hide it on purpose
                versioning: versioning_disabled,
                creation_date: creation_date,
                path: path,
                should_create_underlying_storage: false,
            };
            try {
                nsfs_schema_utils.validate_bucket_schema(bucket_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', "must have required property 'bucket_owner'");
            }
        });

        it('bucket with undefined bucket_owner', () => {
            const bucket_data = {
                name: bucket_name,
                system_owner: system_owner,
                bucket_owner: undefined, // on purpose
                versioning: versioning_disabled,
                creation_date: creation_date,
                path: path,
                should_create_underlying_storage: false,
            };
            try {
                nsfs_schema_utils.validate_bucket_schema(bucket_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', "must have required property 'bucket_owner'");
            }
        });

        it('bucket without versioning', () => {
            const bucket_data = {
                name: bucket_name,
                system_owner: system_owner,
                bucket_owner: bucket_owner,
                // versioning: versioning, // hide it on purpose
                creation_date: creation_date,
                path: path,
                should_create_underlying_storage: false,
            };
            try {
                nsfs_schema_utils.validate_bucket_schema(bucket_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', "must have required property 'versioning'");
            }
        });

        it('bucket with undefined versioning', () => {
            const bucket_data = {
                name: bucket_name,
                system_owner: system_owner,
                bucket_owner: bucket_owner,
                versioning: undefined, // on purpose
                creation_date: creation_date,
                path: path,
                should_create_underlying_storage: false,
            };
            try {
                nsfs_schema_utils.validate_bucket_schema(bucket_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', "must have required property 'versioning'");
            }
        });

        it('bucket without creation_date', () => {
            const bucket_data = {
                name: bucket_name,
                system_owner: system_owner,
                bucket_owner: bucket_owner,
                versioning: versioning_disabled,
                // creation_date: creation_date, // hide it on purpose
                path: path,
                should_create_underlying_storage: false,
            };
            try {
                nsfs_schema_utils.validate_bucket_schema(bucket_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', "must have required property 'creation_date'");
            }
        });

        it('bucket with undefined creation_date', () => {
            const bucket_data = {
                name: bucket_name,
                system_owner: system_owner,
                bucket_owner: bucket_owner,
                versioning: versioning_disabled,
                creation_date: undefined, // on purpose
                path: path,
                should_create_underlying_storage: false,
            };
            try {
                nsfs_schema_utils.validate_bucket_schema(bucket_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', "must have required property 'creation_date'");
            }
        });

        it('bucket without path', () => {
            const bucket_data = {
                name: bucket_name,
                system_owner: system_owner,
                bucket_owner: bucket_owner,
                versioning: versioning_disabled,
                creation_date: creation_date,
                // path: path, // hide it on purpose
                should_create_underlying_storage: false,
            };
            try {
                nsfs_schema_utils.validate_bucket_schema(bucket_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', "must have required property 'path'");
            }
        });

        it('bucket with undefined path', () => {
            const bucket_data = {
                name: bucket_name,
                system_owner: system_owner,
                bucket_owner: bucket_owner,
                versioning: versioning_disabled,
                creation_date: creation_date,
                path: undefined, // on purpose
                should_create_underlying_storage: false,
            };
            try {
                nsfs_schema_utils.validate_bucket_schema(bucket_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', "must have required property 'path'");
            }
        });

        it('bucket without should_create_underlying_storage', () => {
            const bucket_data = {
                name: bucket_name,
                system_owner: system_owner,
                bucket_owner: bucket_owner,
                versioning: versioning_disabled,
                creation_date: creation_date,
                path: path,
                // should_create_underlying_storage: false, // hide it on purpose
            };
            try {
                nsfs_schema_utils.validate_bucket_schema(bucket_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', "must have required property 'should_create_underlying_storage'");
            }
        });

        it('bucket with undefined should_create_underlying_storage', () => {
            const bucket_data = {
                name: bucket_name,
                system_owner: system_owner,
                bucket_owner: bucket_owner,
                versioning: versioning_disabled,
                creation_date: creation_date,
                path: path,
                should_create_underlying_storage: undefined, // on purpose
            };
            try {
                nsfs_schema_utils.validate_bucket_schema(bucket_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', "must have required property 'should_create_underlying_storage'");
            }
        });

    });

    describe('bucket with wrong types', () => {

        it('bucket with creation_date as Date (instead of string)', () => {
            const bucket_data = {
                name: bucket_name,
                system_owner: system_owner,
                bucket_owner: bucket_owner,
                versioning: versioning_disabled,
                creation_date: Date.now(), // Date instead of string
                path: path,
                should_create_underlying_storage: true,
            };
            try {
                nsfs_schema_utils.validate_bucket_schema(bucket_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', 'must be string');
            }
        });

        it('bucket with s3_policy as string (instead of object)', () => {
            const bucket_data = {
                name: bucket_name,
                system_owner: system_owner,
                bucket_owner: bucket_owner,
                versioning: versioning_disabled,
                creation_date: creation_date,
                path: path,
                should_create_underlying_storage: true,
                s3_policy: '', // string instead of object
            };
            try {
                nsfs_schema_utils.validate_bucket_schema(bucket_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', 'must be object');
            }
        });

        it('bucket with should_create_underlying_storage as string (instead of boolean)', () => {
            const bucket_data = {
                name: bucket_name,
                system_owner: system_owner,
                bucket_owner: bucket_owner,
                versioning: versioning_enabled,
                creation_date: creation_date,
                path: path,
                should_create_underlying_storage: 'yes', // string instead of boolean
            };
            try {
                nsfs_schema_utils.validate_bucket_schema(bucket_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', 'must be boolean');
            }
        });

        it('bucket with versioning as string (instead of enum)', () => {
            const bucket_data = {
                name: bucket_name,
                system_owner: system_owner,
                bucket_owner: bucket_owner,
                versioning: 'lala', // not part of definition of versioning
                creation_date: creation_date,
                path: path,
                should_create_underlying_storage: false,
            };
            try {
                nsfs_schema_utils.validate_bucket_schema(bucket_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', 'must be equal to one of the allowed values');
            }
        });

        it('bucket with fs_backend as string (instead of enum)', () => {
            const bucket_data = {
                name: bucket_name,
                system_owner: system_owner,
                bucket_owner: bucket_owner,
                versioning: versioning_enabled,
                creation_date: creation_date,
                path: path,
                should_create_underlying_storage: false,
                fs_backend: '' // not part of definition of fs_backend
            };
            try {
                nsfs_schema_utils.validate_bucket_schema(bucket_data);
                throw_error_in_case_error_was_not_thrown();
            } catch (err) {
                expect(err).toBeInstanceOf(RpcError);
                expect(err).toHaveProperty('message', 'must be equal to one of the allowed values');
            }
        });

    });

});
