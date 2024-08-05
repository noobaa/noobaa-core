/* Copyright (C) 2024 NooBaa */
/*eslint max-lines-per-function: ["error", 500]*/

'use strict';

const nsfs_schema_utils = require('../../../manage_nsfs/nsfs_schema_utils');
const RpcError = require('../../../rpc/rpc_error');
const test_utils = require('../../system_tests/test_utils');
const config = require('../../../../config');

describe('schema validation NC NSFS bucket', () => {
    const versioning_enabled = 'ENABLED';
    const fs_backend1 = 'CEPH_FS';
    const tag1 = [{
        key: "organization",
        value: "marketing"
    }];
    const bucket_name = 'bucket1'; // use in bucket_policy1
    const bucket_policy1 = test_utils.generate_s3_policy('*', bucket_name, ['s3:*']).policy;
    const encryption1 = {
        algorithm: 'AES256',
    };
    const encryption2 = {
        algorithm: 'aws:kms',
        kms_key_id: '1234abcd-12ab-34cd-56ef-1234567890ab',
        // the kms_key_id was taken from the example:
        // https://docs.aws.amazon.com/AmazonS3/latest/API/API_ServerSideEncryptionByDefault.html
    };
    const website1 = {
        website_configuration: {
            redirect_all_requests_to: {
                host_name: 's3.noobaa.io',
                protocol: 'HTTPS',
            }
        }
    };
    const logging = {
        log_bucket: 'bucket2',
        log_prefix: 'bucket1/'
    };

    describe('bucket with all needed properties', () => {

        it('nsfs_bucket', () => {
            const bucket_data = get_bucket_data();
            nsfs_schema_utils.validate_bucket_schema(bucket_data);
        });

        it('nsfs_bucket with versioning ENABLED', () => {
            const bucket_data = get_bucket_data();
            bucket_data.versioning = versioning_enabled;
            nsfs_schema_utils.validate_bucket_schema(bucket_data);
        });

        it('nsfs_bucket with tag', () => {
            const bucket_data = get_bucket_data();
            bucket_data.tag = tag1; // added
            nsfs_schema_utils.validate_bucket_schema(bucket_data);
        });

        it('nsfs_bucket with fs_backend', () => {
            const bucket_data = get_bucket_data();
            bucket_data.fs_backend = fs_backend1; // added
            nsfs_schema_utils.validate_bucket_schema(bucket_data);
        });

        it('nsfs_bucket with s3_policy (bucket policy)', () => {
            const bucket_data = get_bucket_data();
            bucket_data.s3_policy = bucket_policy1; // added
            nsfs_schema_utils.validate_bucket_schema(bucket_data);
        });

        it('nsfs_bucket with encryption1', () => {
            const bucket_data = get_bucket_data();
            bucket_data.encryption = encryption1; // added
            nsfs_schema_utils.validate_bucket_schema(bucket_data);
        });

        it('nsfs_bucket with encryption2', () => {
            const bucket_data = get_bucket_data();
            bucket_data.encryption = encryption2; // added
            nsfs_schema_utils.validate_bucket_schema(bucket_data);
        });

        it('nsfs_bucket with website1', () => {
            const bucket_data = get_bucket_data();
            bucket_data.website = website1; // added
            nsfs_schema_utils.validate_bucket_schema(bucket_data);
        });

        it('nsfs_bucket with force_md5_etag', () => {
            const bucket_data = get_bucket_data();
            bucket_data.force_md5_etag = true; // added
            nsfs_schema_utils.validate_bucket_schema(bucket_data);
        });

        it('nsfs_bucket with logging', () => {
            const bucket_data = get_bucket_data();
            bucket_data.logging = logging;
            nsfs_schema_utils.validate_bucket_schema(bucket_data);
        });

        it('nsfs_bucket with creator', () => {
            const bucket_data = get_bucket_data();
            bucket_data.creator = '65a62e22ceae5e5f1a758ab1';
            nsfs_schema_utils.validate_bucket_schema(bucket_data);
        });
    });

    describe('bucket with additional properties', () => {

        it('bucket with new_name', () => {
            const bucket_data = get_bucket_data();
            bucket_data.new_name = 'bucket2'; // this is not part of the schema
            const reason = 'Test should have failed because of adding additional property ' +
                'new_name';
            const message = 'must NOT have additional properties';
            assert_validation(bucket_data, reason, message);
        });

        it('bucket with my_id inside s3_policy', () => {
            const bucket_data = get_bucket_data();
            bucket_data.s3_policy = bucket_policy1; // added
            bucket_data.s3_policy.my_id = '123'; // this is not part of the schema
            const reason = 'Test should have failed because of adding additional property ' +
                'my_id inside s3_policy';
            const message = 'must NOT have additional properties';
            assert_validation(bucket_data, reason, message);
        });

        it('bucket with my_id inside encryption', () => {
            const bucket_data = get_bucket_data();
            bucket_data.encryption = encryption1; // added
            bucket_data.encryption.my_id = '123'; // this is not part of the schema
            const reason = 'Test should have failed because of adding additional property ' +
                'my_id inside encryption';
            const message = 'must NOT have additional properties';
            assert_validation(bucket_data, reason, message);
        });

        it('bucket with my_id inside website', () => {
            const bucket_data = get_bucket_data();
            bucket_data.website = website1; // added
            bucket_data.website.my_id = '123'; // this is not part of the schema
            const reason = 'Test should have failed because of adding additional property ' +
                'my_id inside website';
            const message = 'must NOT have additional properties';
            assert_validation(bucket_data, reason, message);
        });

        it('bucket with my_id inside logging', () => {
            const bucket_data = get_bucket_data();
            bucket_data.logging = logging;
            bucket_data.logging.my_id = '123'; // this is not part of the schema
            const reason = 'Test should have failed because of adding additional property ' +
                'my_id inside logging';
            const message = 'must NOT have additional properties';
            assert_validation(bucket_data, reason, message);
        });

    });

    // note: had to use " " (double quotes) instead of ' ' (single quotes) to match the message
    describe('bucket without required properties', () => {

        it('bucket without name', () => {
            const bucket_data = get_bucket_data();
            delete bucket_data.name;
            const reason = 'Test should have failed because of missing required property ' +
                'name';
            const message = "must have required property 'name'";
            assert_validation(bucket_data, reason, message);
        });

        it('bucket with undefined name', () => {
            const bucket_data = get_bucket_data();
            bucket_data.name = undefined;
            const reason = 'Test should have failed because of missing required property ' +
                'name';
            const message = "must have required property 'name'";
            assert_validation(bucket_data, reason, message);
        });

        it('bucket without system_owner', () => {
            const bucket_data = get_bucket_data();
            delete bucket_data.system_owner;
            const reason = 'Test should have failed because of missing required property ' +
                'system_owner';
            const message = "must have required property 'system_owner'";
            assert_validation(bucket_data, reason, message);
        });

        it('bucket with undefined system_owner', () => {
            const bucket_data = get_bucket_data();
            bucket_data.system_owner = undefined;
            const reason = 'Test should have failed because of missing required property ' +
                'system_owner';
            const message = "must have required property 'system_owner'";
            assert_validation(bucket_data, reason, message);
        });

        it('bucket without versioning', () => {
            const bucket_data = get_bucket_data();
            delete bucket_data.versioning;
            const reason = 'Test should have failed because of missing required property ' +
                'versioning';
            const message = "must have required property 'versioning'";
            assert_validation(bucket_data, reason, message);
        });

        it('bucket with undefined versioning', () => {
            const bucket_data = get_bucket_data();
            bucket_data.versioning = undefined;
            const reason = 'Test should have failed because of missing required property ' +
                'versioning';
            const message = "must have required property 'versioning'";
            assert_validation(bucket_data, reason, message);
        });

        it('bucket without creation_date', () => {
            const bucket_data = get_bucket_data();
            delete bucket_data.creation_date;
            const reason = 'Test should have failed because of missing required property ' +
                'creation_date';
            const message = "must have required property 'creation_date'";
            assert_validation(bucket_data, reason, message);
        });

        it('bucket with undefined creation_date', () => {
            const bucket_data = get_bucket_data();
            bucket_data.creation_date = undefined;
            const reason = 'Test should have failed because of missing required property ' +
                'creation_date';
            const message = "must have required property 'creation_date'";
            assert_validation(bucket_data, reason, message);
        });

        it('bucket without path', () => {
            const bucket_data = get_bucket_data();
            delete bucket_data.path;
            const reason = 'Test should have failed because of missing required property ' +
                'path';
            const message = "must have required property 'path'";
            assert_validation(bucket_data, reason, message);
        });

        it('bucket with undefined path', () => {
            const bucket_data = get_bucket_data();
            bucket_data.path = undefined;
            const reason = 'Test should have failed because of missing required property ' +
                'path';
            const message = "must have required property 'path'";
            assert_validation(bucket_data, reason, message);
        });

        it('bucket without should_create_underlying_storage', () => {
            const bucket_data = get_bucket_data();
            delete bucket_data.should_create_underlying_storage;
            const reason = 'Test should have failed because of missing required property ' +
                'should_create_underlying_storage';
            const message = "must have required property 'should_create_underlying_storage'";
            assert_validation(bucket_data, reason, message);
        });

        it('bucket with undefined should_create_underlying_storage', () => {
            const bucket_data = get_bucket_data();
            bucket_data.should_create_underlying_storage = undefined;
            const reason = 'Test should have failed because of missing required property ' +
                'should_create_underlying_storage';
            const message = "must have required property 'should_create_underlying_storage'";
            assert_validation(bucket_data, reason, message);
        });

        it('bucket with undefined _id', () => {
            const bucket_data = get_bucket_data();
            bucket_data._id = undefined;
            const reason = 'Test should have failed because of missing required property ' +
                '_id';
            const message = "must have required property '_id'";
            assert_validation(bucket_data, reason, message);
        });

        it('bucket without _id', () => {
            const bucket_data = get_bucket_data();
            delete bucket_data._id;
            const reason = 'Test should have failed because of missing required property ' +
                '_id';
            const message = "must have required property '_id'";
            assert_validation(bucket_data, reason, message);
        });

        it('bucket without owner_account', () => {
            const bucket_data = get_bucket_data();
            delete bucket_data.owner_account;
            const reason = 'Test should have failed because of missing required property ' +
                'owner_account';
            const message = "must have required property 'owner_account'";
            assert_validation(bucket_data, reason, message);
        });

        it('bucket with undefined owner_account', () => {
            const bucket_data = get_bucket_data();
            bucket_data.owner_account = undefined;
            const reason = 'Test should have failed because of missing required property ' +
                'owner_account';
            const message = "must have required property 'owner_account'";
            assert_validation(bucket_data, reason, message);
        });

    });

    describe('bucket with wrong types', () => {

        it('bucket with creation_date as Date (instead of string)', () => {
            const bucket_data = get_bucket_data();
            // @ts-ignore
            bucket_data.creation_date = Date.now(); // Date instead of string
            const reason = 'Test should have failed because of wrong type ' +
                'creation_date with Date (instead of string)';
            const message = 'must be string';
            assert_validation(bucket_data, reason, message);
        });

        it('bucket with s3_policy as string (instead of object)', () => {
            const bucket_data = get_bucket_data();
            // @ts-ignore
            bucket_data.s3_policy = ''; // string instead of object
            const reason = 'Test should have failed because of wrong type ' +
                's3_policy with string (instead of enum)';
            const message = 'must be object';
            assert_validation(bucket_data, reason, message);
        });

        it('bucket with should_create_underlying_storage as string (instead of boolean)', () => {
            const bucket_data = get_bucket_data();
            // @ts-ignore
            bucket_data.should_create_underlying_storage = 'yes'; // string instead of boolean
            const reason = 'Test should have failed because of wrong type ' +
                'should_create_underlying_storage with string (instead of boolean)';
            const message = 'must be boolean';
            assert_validation(bucket_data, reason, message);
        });

        it('bucket with versioning as string (instead of enum)', () => {
            const bucket_data = get_bucket_data();
            // @ts-ignore
            bucket_data.versioning = 'lala'; // not part of definition of versioning
            const reason = 'Test should have failed because of wrong type ' +
                'versioning with string (instead of enum)';
            const message = 'must be equal to one of the allowed values';
            assert_validation(bucket_data, reason, message);
        });

        it('bucket with fs_backend as string (instead of enum)', () => {
            const bucket_data = get_bucket_data();
            // @ts-ignore
            bucket_data.fs_backend = ''; // not part of definition of fs_backend
            const reason = 'Test should have failed because of wrong type ' +
                'fs_backend with string (instead of enum)';
            const message = 'must be equal to one of the allowed values';
            assert_validation(bucket_data, reason, message);
        });

        it('bucket with encryption as string (instead of object)', () => {
            const bucket_data = get_bucket_data();
            // @ts-ignore
            bucket_data.encryption = ''; // not part of definition of encryption
            const reason = 'Test should have failed because of wrong type ' +
                'encryption with string (instead of object)';
            const message = 'must be object';
            assert_validation(bucket_data, reason, message);
        });

        it('bucket with website as string (instead of object)', () => {
            const bucket_data = get_bucket_data();
            // @ts-ignore
            bucket_data.website = ''; // not part of definition of website
            const reason = 'Test should have failed because of wrong type ' +
                'website with string (instead of object)';
            const message = 'must be object';
            assert_validation(bucket_data, reason, message);
        });

        it('bucket with _id as number (instead of string)', () => {
            const bucket_data = get_bucket_data();
            // @ts-ignore
            bucket_data._id = 123; // number instead of string
            const reason = 'Test should have failed because of wrong type ' +
                '_id with number (instead of string)';
            const message = 'must be string';
            assert_validation(bucket_data, reason, message);
        });

        it('bucket with owner_account as number (instead of string)', () => {
            const bucket_data = get_bucket_data();
            // @ts-ignore
            bucket_data.owner_account = 123; // number instead of string
            const reason = 'Test should have failed because of wrong type ' +
                'owner_account with number (instead of string)';
            const message = 'must be string';
            assert_validation(bucket_data, reason, message);
        });

        it('bucket with force_md5_etag as string (instead of boolean)', () => {
            const bucket_data = get_bucket_data();
            // @ts-ignore
            bucket_data.force_md5_etag = "aaa"; // number instead of string
            const reason = 'Test should have failed because of wrong type ' +
                'force_md5_etag with boolean (instead of string)';
            const message = 'must be boolean';
            assert_validation(bucket_data, reason, message);
        });

        it('bucket with logging as string (instead of object)', () => {
            const bucket_data = get_bucket_data();
            // @ts-ignore
            bucket_data.logging = ''; // not part of definition of logging
            const reason = 'Test should have failed because of wrong type ' +
                'logging with string (instead of object)';
            const message = 'must be object';
            assert_validation(bucket_data, reason, message);
        });

        it('bucket with creator as a number (instead of string)', () => {
            const bucket_data = get_bucket_data();
            bucket_data.creator = 123; // number instead of string
            const reason = 'Test should have failed because of wrong type for' +
                'creator with number (instead of string)';
            const message = 'must be string';
            assert_validation(bucket_data, reason, message);
        });
    });

    describe('skip schema check by config test', () => {
        it('skip schema check by config test - invalid bucket should pass', () => {
            config.NC_DISABLE_SCHEMA_CHECK = true;
            const bucket_data = get_bucket_data();
            bucket_data.name = '1'; // invalid name
            nsfs_schema_utils.validate_bucket_schema(bucket_data);
            config.NC_DISABLE_SCHEMA_CHECK = false;
        });
    });
});

function get_bucket_data() {
    const bucket_name = 'bucket1';
    const id = '65a62e22ceae5e5f1a758aa8';
    const system_owner = '65b3c68b59ab67b16f98c26e'; // GAP - currently bucker owner account id
    const owner_account = '65b3c68b59ab67b16f98c26e';
    const versioning_disabled = 'DISABLED';
    const creation_date = new Date('December 17, 2023 09:00:00').toISOString();
    const path = '/tmp/nsfs_root1';

    const bucket_data = {
        _id: id,
        name: bucket_name,
        system_owner: system_owner,
        owner_account: owner_account,
        versioning: versioning_disabled,
        creation_date: creation_date,
        path: path,
        should_create_underlying_storage: true,
    };

    return bucket_data;
}

function assert_validation(bucket_to_validate, reason, basic_message) {
    try {
        nsfs_schema_utils.validate_bucket_schema(bucket_to_validate);
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
