/* Copyright (C) 2016 NooBaa */
'use strict';

const path = require('path');
const http = require('http');
const mocha = require('mocha');
const assert = require('assert');
const config = require('../../../config');
const { get_coretest_path, TMP_PATH, TEST_TIMEOUT, update_system_json } = require('../system_tests/test_utils');
const { S3 } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const { folder_delete } = require('../../util/fs_utils');
const coretest_path = get_coretest_path();
const coretest = require(coretest_path);
const { rpc_client, EMAIL, NC_CORETEST_CONFIG_FS } = coretest;
coretest.setup({});

const new_buckets_path = path.join(TMP_PATH, 'test_nc_online_upgrade_new_buckets_path');
const bucket_storage_path = path.join(new_buckets_path, 'bucket1');
const mock_old_config_dir_version = '0.0.0';
const mock_obj_key = 'key1';
const mock_obj_body = 'blblblblblblalalal';

const s3_creds = {
    forcePathStyle: true,
    region: config.DEFAULT_REGION,
    requestHandler: new NodeHttpHandler({
        httpAgent: new http.Agent({ keepAlive: false })
    }),
};

const account_defaults = {
    name: 'account1',
    new_buckets_path,
    user: 'root'
};

const bucket_defaults = {
    name: 'bucket1',
    path: bucket_storage_path,
    owner: account_defaults.name
};

const bucket_policy = {
    Version: '2012-10-17',
    Statement: [{
        Sid: 'id-1',
        Effect: 'Allow',
        Principal: { AWS: "*" },
        Action: ['s3:*'],
        Resource: [`arn:aws:s3:::*`]
    }
    ]
};

// create/update/delete bucket ops are not allowed during upgrade
// list/get/head bucket is allowed
// object operations are allowed
mocha.describe('online upgrade S3 bucket operations tests', function() {

    let s3_client;

    mocha.before(async () => {
        const admin_keys = (await rpc_client.account.read_account({ email: EMAIL, })).access_keys;
        s3_creds.credentials = {
            accessKeyId: admin_keys[0].access_key.unwrap(),
            secretAccessKey: admin_keys[0].secret_key.unwrap(),
        };
        s3_creds.endpoint = coretest.get_http_address();
        s3_client = new S3(s3_creds);
    });

    mocha.after(async () => {
        await folder_delete(new_buckets_path);
    });

    mocha.afterEach(async () => {
        // restore config dir
        const orig_config_dir = NC_CORETEST_CONFIG_FS.config_dir_version;
        await update_system_json(NC_CORETEST_CONFIG_FS, orig_config_dir);
        try {
            await s3_client.deleteObject({ Bucket: bucket_defaults.name, Key: mock_obj_key });
        } catch (err) {
            console.log('test_nc_online_upgrade_s3_integrations: failed deleting mock key', err);
        }
        try {
            await s3_client.deleteBucket({ Bucket: bucket_defaults.name });
        } catch (err) {
            console.log('test_nc_online_upgrade_s3_integrations: failed deleting default bucket', err);
        }
    });

    mocha.it('create bucket - host is blocked for config dir updates - should fail create/delete/update bucket ops', async function() {
        await update_system_json(NC_CORETEST_CONFIG_FS, mock_old_config_dir_version);
        await assert.rejects(async () => s3_client.createBucket({ Bucket: bucket_defaults.name }), err => {
            assert.strictEqual(err.Code, 'InternalError');
            return true;
        });
    }, TEST_TIMEOUT);

    mocha.it('create bucket - host is not blocked for config dir updates', async function() {
        await update_system_json(NC_CORETEST_CONFIG_FS);
        await s3_client.createBucket({ Bucket: bucket_defaults.name });
    }, TEST_TIMEOUT);

    mocha.it('put bucket policy - host is blocked for config dir updates - should fail create/delete/update bucket ops', async function() {
        await create_default_bucket(s3_client, bucket_defaults.name);
        await update_system_json(NC_CORETEST_CONFIG_FS, mock_old_config_dir_version);
        await assert.rejects(async () => s3_client.putBucketPolicy({ Bucket: bucket_defaults.name, Policy: JSON.stringify(bucket_policy) }),
            err => {
                assert.strictEqual(err.Code, 'InternalError');
                return true;
            }
        );
    }, TEST_TIMEOUT);

    mocha.it('put bucket policy - host is not blocked for config dir updates', async function() {
        await create_default_bucket(s3_client, bucket_defaults.name);
        await update_system_json(NC_CORETEST_CONFIG_FS);
        await s3_client.putBucketPolicy({ Bucket: bucket_defaults.name, Policy: JSON.stringify(bucket_policy) });
    }, TEST_TIMEOUT);

    mocha.it('delete bucket - host is blocked for config dir updates - should fail create/delete/update bucket ops', async function() {
        await create_default_bucket(s3_client, bucket_defaults.name);
        await update_system_json(NC_CORETEST_CONFIG_FS, mock_old_config_dir_version);
        await assert.rejects(async () => s3_client.deleteBucket({ Bucket: bucket_defaults.name }), err => {
            assert.strictEqual(err.Code, 'InternalError');
            return true;
        });
    }, TEST_TIMEOUT);

    mocha.it('delete bucket - host is not blocked for config dir updates', async function() {
        await create_default_bucket(s3_client, bucket_defaults.name);
        await update_system_json(NC_CORETEST_CONFIG_FS);
        await s3_client.deleteBucket({ Bucket: bucket_defaults.name });
    }, TEST_TIMEOUT);

    mocha.it('head bucket - should not fail bucket head/get/list ops', async function() {
        await create_default_bucket(s3_client, bucket_defaults.name);
        await update_system_json(NC_CORETEST_CONFIG_FS, mock_old_config_dir_version);
        await s3_client.headBucket({ Bucket: bucket_defaults.name });
    }, TEST_TIMEOUT);

    mocha.it('PUT object - host is blocked for config dir updates - should not fail object ops', async function() {
        await create_default_bucket(s3_client, bucket_defaults.name);
        await update_system_json(NC_CORETEST_CONFIG_FS, mock_old_config_dir_version);
        await s3_client.putObject({ Bucket: bucket_defaults.name, Key: mock_obj_key, Body: mock_obj_body });
    }, TEST_TIMEOUT);

    mocha.it('GET object - host is blocked for config dir updates - should not fail object ops', async function() {
        await create_default_bucket(s3_client, bucket_defaults.name);
        await create_mock_object(s3_client, bucket_defaults.name, mock_obj_key, mock_obj_body);
        await update_system_json(NC_CORETEST_CONFIG_FS, mock_old_config_dir_version);
        await s3_client.getObject({ Bucket: bucket_defaults.name, Key: mock_obj_key});
    }, TEST_TIMEOUT);

    mocha.it('HEAD object - host is blocked for config dir updates - should not fail object ops', async function() {
        await create_default_bucket(s3_client, bucket_defaults.name);
        await create_mock_object(s3_client, bucket_defaults.name, mock_obj_key, mock_obj_body);
        await update_system_json(NC_CORETEST_CONFIG_FS, mock_old_config_dir_version);
        await s3_client.headObject({ Bucket: bucket_defaults.name, Key: mock_obj_key});
    }, TEST_TIMEOUT);

    mocha.it('DELETE object - host is blocked for config dir updates - should not fail object ops', async function() {
        await create_default_bucket(s3_client, bucket_defaults.name);
        await create_mock_object(s3_client, bucket_defaults.name, mock_obj_key, mock_obj_body);
        await update_system_json(NC_CORETEST_CONFIG_FS, mock_old_config_dir_version);
        await s3_client.deleteObject({ Bucket: bucket_defaults.name, Key: mock_obj_key});
    }, TEST_TIMEOUT);
}, TEST_TIMEOUT);


/**
 * create_default_bucket creates the default bucket for tests that require an existing bucket
 * @param {*} s3_client 
 * @param {String} bucket_name 
 * @returns {Promise<Void>}
 */
async function create_default_bucket(s3_client, bucket_name) {
    await s3_client.createBucket({ Bucket: bucket_name });
}

/**
 * create_mock_object creates a mock object for tests that require an existing object
 * @param {*} s3_client 
 * @param {String} bucket_name 
 * @param {String} key 
 * @param {String} body 
 * @returns {Promise<Void>}
 */
async function create_mock_object(s3_client, bucket_name, key, body) {
    await s3_client.putObject({ Bucket: bucket_name, Key: key, Body: body });
}
