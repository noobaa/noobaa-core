/* Copyright (C) 2024 NooBaa */

'use strict';

const nsfs_schema_utils = require('../../../manage_nsfs/nsfs_schema_utils');
const RpcError = require('../../../rpc/rpc_error');

describe('schema validation NC NSFS account', () => {
    const access_key1 = 'GIGiFAnjaaE7OKD5N7hA';
    const secret_key2 = 'U2AYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE';
    const fs_backend1 = 'GPFS';
    const distinguished_name = 'moti-1003';
    const new_bucket_path = '/tmp/nsfs_root1';

    describe('account with all needed properties', () => {

        it('nsfs_account_config with uid, gid', () => {
            const account_data = get_account_data();
            nsfs_schema_utils.validate_account_schema(account_data);
        });

        it('nsfs_account_config with distinguished_name', () => {
            const account_data = get_account_data();
            delete account_data.nsfs_account_config;
            account_data.nsfs_account_config = {
                // @ts-ignore
                distinguished_name: distinguished_name, // added
            };
            nsfs_schema_utils.validate_account_schema(account_data);
        });

        it('nsfs_account_config with fs_backend', () => {
            const account_data = get_account_data();
            // @ts-ignore
            account_data.nsfs_account_config.fs_backend = fs_backend1; // added
            nsfs_schema_utils.validate_account_schema(account_data);
        });

        it('nsfs_account_config with new_bucket_path', () => {
            const account_data = get_account_data();
            // @ts-ignore
            account_data.nsfs_account_config.new_buckets_path = new_bucket_path; // added
            nsfs_schema_utils.validate_account_schema(account_data);
        });

        it('nsfs_account_config with force_md5_etag', () => {
            const account_data = get_account_data();
            // @ts-ignore
            account_data.force_md5_etag = true; // added
            nsfs_schema_utils.validate_account_schema(account_data);
        });

    });

    describe('account with additional properties', () => {

        it('nsfs_account_config with distinguished_name AND uid gid', () => {
            const account_data = get_account_data();
            // @ts-ignore
            account_data.nsfs_account_config.distinguished_name = distinguished_name; // this is not part of the schema
            const reason = 'Test should have failed because of adding additional property ' +
                'distinguished_name AND uid gid';
            const message = 'must NOT have additional properties';
            assert_validation(account_data, reason, message);
        });

        it('account with new_name', () => {
            const account_data = get_account_data();
            // @ts-ignore
            account_data.new_name = 'account2'; // this is not part of the schema
            const reason = 'Test should have failed because of adding additional property ' +
                'new_name';
            const message = 'must NOT have additional properties';
            assert_validation(account_data, reason, message);
        });

        // note: it is new_access_key (and not new_access_keys in the code)
        it('account with new_access_key', () => {
            const account_data = get_account_data();
            // @ts-ignore
            account_data.new_access_key = [ // this is not part of the schema
                {
                    access_key: access_key1,
                    encrypted_secret_key: secret_key2
                },
            ];
            const reason = 'Test should have failed because of adding additional property ' +
                'new_access_key';
            const message = 'must NOT have additional properties';
            assert_validation(account_data, reason, message);
        });

        it('account with duration_seconds inside access_keys', () => {
            const account_data = get_account_data();
            // @ts-ignore
            account_data.access_keys[0].duration_seconds = 3600; // this is not part of the schema
            const reason = 'Test should have failed because of adding additional property ' +
                'duration_seconds';
            const message = 'must NOT have additional properties';
            assert_validation(account_data, reason, message);
        });

        it('account with my_id inside nsfs_account_config', () => {
            const account_data = get_account_data();
            // @ts-ignore
            account_data.nsfs_account_config.my_id = 123; // this is not part of the schema
            const reason = 'Test should have failed because of adding additional property ' +
                'my_id';
            const message = 'must NOT have additional properties';
            assert_validation(account_data, reason, message);
        });

    });

    // note: had to use " " (double quotes) instead of ' ' (single quotes) to match the message
    describe('account without required properties', () => {

        it('account without name', () => {
            const account_data = get_account_data();
            delete account_data.name;
            const reason = 'Test should have failed because of missing required property ' +
                'name';
            const message = "must have required property 'name'";
            assert_validation(account_data, reason, message);
        });

        it('account with undefined name', () => {
            const account_data = get_account_data();
            account_data.name = undefined;
            const reason = 'Test should have failed because of missing required property ' +
                'name';
            const message = "must have required property 'name'";
            assert_validation(account_data, reason, message);
        });

        it('account without email', () => {
            const account_data = get_account_data();
            delete account_data.email;
            const reason = 'Test should have failed because of missing required property ' +
                'email';
            const message = "must have required property 'email'";
            assert_validation(account_data, reason, message);
        });

        it('account with undefined email', () => {
            const account_data = get_account_data();
            account_data.email = undefined;
            const reason = 'Test should have failed because of missing required property ' +
                'email';
            const message = "must have required property 'email'";
            assert_validation(account_data, reason, message);
        });

        it('account without access_keys', () => {
            const account_data = get_account_data();
            delete account_data.access_keys;
            const reason = 'Test should have failed because of missing required property ' +
                'access_keys';
            const message = "must have required property 'access_keys'";
            assert_validation(account_data, reason, message);
        });

        it('account with undefined access_keys', () => {
            const account_data = get_account_data();
            account_data.access_keys = undefined;
            const reason = 'Test should have failed because of missing required property ' +
                'access_keys';
            const message = "must have required property 'access_keys'";
            assert_validation(account_data, reason, message);
        });

        it('account without access_keys details (access_key and secret_key)', () => {
            const account_data = get_account_data();
            delete account_data.access_keys[0].access_key;
            delete account_data.access_keys[0].encrypted_secret_key;
            const reason = 'Test should have failed because of missing required property ' +
                'access_key';
            const message = "must have required property 'access_key'";
            assert_validation(account_data, reason, message);
        });

        it('account without access_key', () => {
            const account_data = get_account_data();
            delete account_data.access_keys[0].access_key;
            const reason = 'Test should have failed because of missing required property ' +
                'access_key';
            const message = "must have required property 'access_key'";
            assert_validation(account_data, reason, message);
        });

        it('account with undefined access_key', () => {
            const account_data = get_account_data();
            account_data.access_keys[0].access_key = undefined;
            const reason = 'Test should have failed because of missing required property ' +
                'access_key';
            const message = "must have required property 'access_key'";
            assert_validation(account_data, reason, message);
        });

        it('account without secret_key', () => {
            const account_data = get_account_data();
            delete account_data.access_keys[0].encrypted_secret_key;
            const reason = 'Test should have failed because of missing required property ' +
                'encrypted_secret_key';
            const message = "must have required property 'encrypted_secret_key'";
            assert_validation(account_data, reason, message);
        });

        it('account with undefined secret_key', () => {
            const account_data = get_account_data();
            account_data.access_keys[0].encrypted_secret_key = undefined;
            const reason = 'Test should have failed because of missing required property ' +
                'encrypted_secret_key';
            const message = "must have required property 'encrypted_secret_key'";
            assert_validation(account_data, reason, message);
        });

        it('account without nsfs_account_config', () => {
            const account_data = get_account_data();
            delete account_data.nsfs_account_config;
            const reason = 'Test should have failed because of missing required property ' +
                'nsfs_account_config';
            const message = "must have required property 'nsfs_account_config'";
            assert_validation(account_data, reason, message);
        });

        it('account with undefined nsfs_account_config', () => {
            const account_data = get_account_data();
            account_data.nsfs_account_config = undefined;
            const reason = 'Test should have failed because of missing required property ' +
                'nsfs_account_config';
            const message = "must have required property 'nsfs_account_config'";
            assert_validation(account_data, reason, message);
        });

        it('account without nsfs_account_config details (uid gid or distinguished_name)', () => {
            const account_data = get_account_data();
            // @ts-ignore
            account_data.nsfs_account_config = {};
            const reason = 'Test should have failed because of missing required property ' +
                'uid AND gid or distinguished_name';
            const message = "must have required property 'uid'";
            assert_validation(account_data, reason, message);
        });

        it('account without creation_date', () => {
            const account_data = get_account_data();
            delete account_data.creation_date;
            const reason = 'Test should have failed because of missing required property ' +
                'creation_date';
            const message = "must have required property 'creation_date'";
            assert_validation(account_data, reason, message);
        });

        it('account with undefined creation_date', () => {
            const account_data = get_account_data();
            account_data.creation_date = undefined;
            const reason = 'Test should have failed because of missing required property ' +
                'creation_date';
            const message = "must have required property 'creation_date'";
            assert_validation(account_data, reason, message);
        });

        it('account without allow_bucket_creation', () => {
            const account_data = get_account_data();
            delete account_data.allow_bucket_creation;
            const reason = 'Test should have failed because of missing required property ' +
                'allow_bucket_creation';
            const message = "must have required property 'allow_bucket_creation'";
            assert_validation(account_data, reason, message);
        });

        it('account with undefined allow_bucket_creation', () => {
            const account_data = get_account_data();
            account_data.allow_bucket_creation = undefined;
            const reason = 'Test should have failed because of missing required property ' +
                'allow_bucket_creation';
            const message = "must have required property 'allow_bucket_creation'";
            assert_validation(account_data, reason, message);
        });

        it('account without _id', () => {
            const account_data = get_account_data();
            delete account_data._id;
            const reason = 'Test should have failed because of missing required property ' +
                '_id';
            const message = "must have required property '_id'";
            assert_validation(account_data, reason, message);
        });

        it('account with undefined _id', () => {
            const account_data = get_account_data();
            account_data._id = undefined;
            const reason = 'Test should have failed because of missing required property ' +
                '_id';
            const message = "must have required property '_id'";
            assert_validation(account_data, reason, message);
        });

        it('account without master_key_id', () => {
            const account_data = get_account_data();
            account_data.master_key_id = undefined;
            const reason = 'Test should have failed because of missing required property ' +
                'master_key_id';
            const message = "must have required property 'master_key_id'";
            assert_validation(account_data, reason, message);
        });

        it('account with undefined master_key_id', () => {
            const account_data = get_account_data();
            account_data.master_key_id = undefined;
            const reason = 'Test should have failed because of missing required property ' +
                'master_key_id';
            const message = "must have required property 'master_key_id'";
            assert_validation(account_data, reason, message);
        });
    });

    describe('account with wrong types', () => {

        it('nsfs_account_config with uid, gid as boolean (instead of number)', () => {
            const account_data = get_account_data();
            delete account_data.nsfs_account_config;
            account_data.nsfs_account_config = {
                // boolean instead of number
                // @ts-ignore
                uid: false,
                // @ts-ignore
                gid: false,
            };
            const reason = 'Test should have failed because of wrong type ' +
                'uid AND gid with boolean (instead of number)';
            const message = 'must be number';
            assert_validation(account_data, reason, message);
        });

        it('nsfs_account_config with creation_date as Date (instead of string)', () => {
            const account_data = get_account_data();
            // @ts-ignore
            account_data.creation_date = Date.now(); // Date instead of string
            const reason = 'Test should have failed because of wrong type ' +
                'creation_date with Date (instead of string)';
            const message = 'must be string';
            assert_validation(account_data, reason, message);
        });

        it('nsfs_account_config with fs_backend as string (instead of enum)', () => {
            const account_data = get_account_data();
            // @ts-ignore
            account_data.nsfs_account_config.fs_backend = ''; // string instead of enum
            const reason = 'Test should have failed because of wrong type ' +
                'fs_backend with string (instead of enum)';
            const message = 'must be equal to one of the allowed values';
            assert_validation(account_data, reason, message);
        });

        it('nsfs_account_config with force_md5_etag as a string (instead of boolean)', () => {
            const account_data = get_account_data();
            // @ts-ignore
            account_data.force_md5_etag = ""; // added
            const reason = 'Test should have failed because of wrong type for' +
                'force_md5_etag (string instead of boolean)';
            const message = 'must be boolean';
            assert_validation(account_data, reason, message);
        });
    });

});


function get_account_data() {
    const account_name = 'account1';
    const id = '65a62e22ceae5e5f1a758aa9';
    const master_key_id = '65a62e22ceae5e5f1a758123';
    const account_email = account_name; // temp, keep the email internally
    const access_key = 'GIGiFAnjaaE7OKD5N7hA';
    const secret_key = 'U2AYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE';
    const creation_date = new Date('December 17, 2023 09:00:00').toISOString();
    const nsfs_account_config_uid_gid = {
        uid: 1001,
        gid: 1001,
    };

    const account_data = {
        _id: id,
        name: account_name,
        email: account_email,
        master_key_id: master_key_id,
        access_keys: [{
            access_key: access_key,
            encrypted_secret_key: secret_key
        }, ],
        nsfs_account_config: {
            ...nsfs_account_config_uid_gid
        },
        creation_date: creation_date,
        allow_bucket_creation: true,
    };

    return account_data;
}

function assert_validation(account_to_validate, reason, basic_message) {
    try {
        nsfs_schema_utils.validate_account_schema(account_to_validate);
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
