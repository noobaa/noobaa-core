/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[0]] });
const { rpc_client, EMAIL } = coretest;

const _ = require('lodash');
const { S3 } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const https = require('https');
const mocha = require('mocha');
const assert = require('assert');

const FILE_BODY = 'FUN FACT: SLOTHS CAN SWIM';
const FILE_NAME = 'sloth-file.txt';
const FILE_NAME_COPY = 'sloth-file-copy.txt';
const SSECustomerKeyOrig = '123456789012345678901234567890AB';
const SSECustomerKeyCopy = '123456789012345678901234567890AC';
const SKIP_TEST = !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY;
const config = require('../../../config');

async function get_s3_instances() {
    const account_info = await rpc_client.account.read_account({
        email: EMAIL,
    });

    const local_s3 = new S3({
        endpoint: coretest.get_https_address(),
        region: config.DEFAULT_REGION,
        credentials: {
            accessKeyId: account_info.access_keys[0].access_key.unwrap(),
            secretAccessKey: account_info.access_keys[0].secret_key.unwrap(),
        },
        forcePathStyle: true,
        tls: true,
        requestHandler: new NodeHttpHandler({
            httpsAgent: new https.Agent({ keepAlive: false, rejectUnauthorized: false })
        }),
    });

    const aws_s3 = new S3({
        region: config.DEFAULT_REGION,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
        forcePathStyle: true,
        tls: true,
        requestHandler: new NodeHttpHandler({
            httpsAgent: new https.Agent({ keepAlive: false, rejectUnauthorized: false })
        }),
    });

    coretest.log('S3 CONFIG local_s3', local_s3.config);
    coretest.log('S3 CONFIG aws_s3', aws_s3.config);
    return { aws_s3, local_s3 };
}

mocha.describe('Bucket Encryption Operations', async () => {

    const BKT = 'sloth-bucket-encryption';
    let local_s3;

    mocha.before(async () => {
        [, local_s3] = Object.values(await get_s3_instances());
    });

    mocha.it('should create bucket', async () => {
        await local_s3.createBucket({ Bucket: BKT });
    });

    mocha.it('getBucketEncryption should return the default server side encryption configuration', async () => {
        try {
            const res = await local_s3.getBucketEncryption({ Bucket: BKT });
            const expected_response = {
                ServerSideEncryptionConfiguration: {
                    Rules: [{
                        ApplyServerSideEncryptionByDefault: {
                            SSEAlgorithm: 'AES256'
                        }
                    }]
                }
            };
            const res_without_metadata = _.omit(res, '$metadata');
            assert.deepEqual(res_without_metadata, expected_response);
        } catch (error) {
            throw new Error(`The server side encryption configuration was not found ${error.message}`);
        }
    });

    mocha.it('should configure bucket encryption', async () => {
        const params = {
            Bucket: BKT,
            ServerSideEncryptionConfiguration: {
                Rules: [{
                    ApplyServerSideEncryptionByDefault: {
                        SSEAlgorithm: 'AES256',
                        // KMSMasterKeyID: 'Sloth'
                    }
                }, ]
            },
        };
        await local_s3.putBucketEncryption(params);
    });

    mocha.it('should get bucket encryption', async () => {
        const res = await local_s3.getBucketEncryption({ Bucket: BKT });
        const expected_response = {
            ServerSideEncryptionConfiguration: {
                Rules: [{
                    ApplyServerSideEncryptionByDefault: {
                        SSEAlgorithm: 'AES256'
                    }
                }]
            }
        };
        const res_without_metadata = _.omit(res, '$metadata');
        assert.deepEqual(res_without_metadata, expected_response);
    });

    mocha.it('should delete bucket encryption', async () => {
        await local_s3.deleteBucketEncryption({ Bucket: BKT });
    });

    mocha.it('should get bucket encryption error without encryption configured', async () => {
        try {
            const res = await local_s3.getBucketEncryption({ Bucket: BKT });
            throw new Error(`Expected to get an error with unconfigured bucket encryption ${res}`);
        } catch (error) {
            assert(error.message === 'The server side encryption configuration was not found.', `Error message does not match got: ${error.message}`);
            assert(error.Code === 'ServerSideEncryptionConfigurationNotFoundError', `Error code does not match got: ${error.Code}`);
            assert(error.$metadata.httpStatusCode === 404, `Error status code does not match got: ${error.$metadata.httpStatusCode}`);
        }
    });

    mocha.it('should put encrypted object and copy with different encryption', async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(100000);
        await copy(local_s3, BKT);
    });

    mocha.it('should put encrypted object parts and copy parts with different encryption', async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);
        await copy_part(local_s3, BKT);
    });

    mocha.after(async () => {
        await local_s3.deleteBucket({ Bucket: BKT });
    });
});

mocha.describe('Bucket Namespace S3 Encryption Operations', async function() {
    const BKT = 'sloth-ns-bucket-encryption';
    const CONNECTION_NAME = 'aws_connection1';
    const AWS_TARGET_BUCKET = 'test-sloth-ns-bucket-encryption';
    const RESOURCE_NAME = 'sloth_ns_target_bucket';

    let aws_s3;
    let local_s3;

    if (SKIP_TEST) {
        coretest.log('No AWS credentials found in env. Skipping test');
        this.skip(); // eslint-disable-line no-invalid-this
    }

    mocha.before(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);
        [aws_s3, local_s3] = Object.values(await get_s3_instances());
        const nsr = { resource: RESOURCE_NAME };
        const read_resources = [nsr];
        const write_resource = nsr;
        await aws_s3.createBucket({ Bucket: AWS_TARGET_BUCKET });
        await rpc_client.account.add_external_connection({
            name: CONNECTION_NAME,
            endpoint: 'https://s3.amazonaws.com',
            endpoint_type: 'AWS',
            identity: process.env.AWS_ACCESS_KEY_ID,
            secret: process.env.AWS_SECRET_ACCESS_KEY,
        });
        await rpc_client.pool.create_namespace_resource({
            name: RESOURCE_NAME,
            connection: CONNECTION_NAME,
            target_bucket: AWS_TARGET_BUCKET
        });
        await rpc_client.bucket.create_bucket({ name: BKT, namespace: { read_resources, write_resource } });
    });

    mocha.it('should get bucket encryption error without encryption configured', async () => {
        try {
            const res = await local_s3.getBucketEncryption({ Bucket: BKT });
            throw new Error(`Expected to get error with unconfigured bucket encryption ${res}`);
        } catch (error) {
            assert(error.message === 'The server side encryption configuration was not found.', `Error message does not match got: ${error.message}`);
            assert(error.Code === 'ServerSideEncryptionConfigurationNotFoundError', `Error code does not match got: ${error.Code}`);
            assert(error.$metadata.httpStatusCode === 404, `Error status code does not match got: ${error.$metadata.httpStatusCode}`);
        }
    });

    mocha.it('should configure bucket encryption', async () => {
        const params = {
            Bucket: BKT,
            ServerSideEncryptionConfiguration: {
                Rules: [{
                    ApplyServerSideEncryptionByDefault: {
                        SSEAlgorithm: 'AES256',
                        // KMSMasterKeyID: 'Sloth'
                    }
                }, ]
            },
        };
        await local_s3.putBucketEncryption(params);
    });

    mocha.it('should get bucket encryption', async () => {
        const res = await local_s3.getBucketEncryption({ Bucket: BKT });
        const expected_response = {
            ServerSideEncryptionConfiguration: {
                Rules: [{
                    ApplyServerSideEncryptionByDefault: {
                        SSEAlgorithm: 'AES256'
                    }
                }]
            }
        };
        assert.deepEqual(res, expected_response);
    });

    mocha.it('should delete bucket encryption', async () => {
        await local_s3.deleteBucketEncryption({ Bucket: BKT });
    });

    mocha.it('should get bucket encryption error without encryption configured', async () => {
        try {
            const res = await local_s3.getBucketEncryption({ Bucket: BKT });
            throw new Error(`Expected to get error with unconfigured bucket encryption ${res}`);
        } catch (error) {
            assert(error.message === 'The server side encryption configuration was not found.', `Error message does not match got: ${error.message}`);
            assert(error.Code === 'ServerSideEncryptionConfigurationNotFoundError', `Error code does not match got: ${error.Code}`);
            assert(error.$metadata.httpStatusCode === 404, `Error status code does not match got: ${error.$metadata.httpStatusCode}`);
        }
    });

    mocha.it('should put encrypted object and copy with different encryption', async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(100000);
        await copy(local_s3, BKT);
    });

    mocha.it('should put encrypted object parts and copy parts with different encryption', async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);
        await copy_part(local_s3, BKT);
    });

    mocha.after(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);
        await rpc_client.bucket.delete_bucket({ name: BKT });
        await rpc_client.pool.delete_namespace_resource({
            name: RESOURCE_NAME,
        });
        await rpc_client.account.delete_external_connection({
            connection_name: CONNECTION_NAME,
        });
        await aws_s3.deleteBucket({ Bucket: AWS_TARGET_BUCKET });
    });
});

async function copy_part(s3_client, BKT) {
    await s3_client.putObject({
        Bucket: BKT,
        Key: FILE_NAME,
        Body: FILE_BODY,
        ContentType: 'text/plain',
        SSECustomerAlgorithm: 'AES256',
        SSECustomerKey: SSECustomerKeyOrig,
    });

    const mp_init = await s3_client.createMultipartUpload({
        Bucket: BKT,
        Key: FILE_NAME_COPY,
        ContentType: 'text/plain',
        SSECustomerAlgorithm: 'AES256',
        SSECustomerKey: SSECustomerKeyCopy,
    });

    const part = await s3_client.uploadPartCopy({
        Bucket: BKT,
        Key: FILE_NAME_COPY,
        UploadId: mp_init.UploadId,
        PartNumber: 1,
        CopySource: `/${BKT}/${FILE_NAME}`,
        CopySourceRange: "bytes=0-24",
        CopySourceSSECustomerAlgorithm: 'AES256',
        CopySourceSSECustomerKey: SSECustomerKeyOrig,
        SSECustomerAlgorithm: 'AES256',
        SSECustomerKey: SSECustomerKeyCopy,
    });

    await s3_client.completeMultipartUpload({
        Bucket: BKT,
        Key: FILE_NAME_COPY,
        UploadId: mp_init.UploadId,
        MultipartUpload: {
            Parts: [{
                ETag: part.CopyPartResult.ETag,
                PartNumber: 1
            }]
        }
    });

    try {
        const reply = await s3_client.headObject({
            Bucket: BKT,
            Key: FILE_NAME_COPY,
        });
        throw new Error(`Expected to get error with access without encryption keys ${reply}`);
    } catch (error) {
        // TODO: Should be this error: An error occurred (400) when calling the HeadObject operation: Bad Request
        assert(error.message === null || error.message === 'UnknownError', `Error message does not match got: ${error.message}`);
        assert(error.Code === 'BadRequest' || error.Code === undefined, `Error code does not match got: ${error.Code}`);
        assert(error.$metadata.httpStatusCode === 500 || error.$metadata.httpStatusCode === 400, `Error status code does not match got: ${error.$metadata.httpStatusCode}`);
    }

    try {
        const reply = await s3_client.headObject({
            Bucket: BKT,
            Key: FILE_NAME_COPY,
            SSECustomerAlgorithm: 'AES256',
            SSECustomerKey: SSECustomerKeyOrig,
        });
        throw new Error(`Expected to get error with access without old encryption keys ${reply}`);
    } catch (error) {
        // TODO: Should be this error: An error occurred (400) when calling the HeadObject operation: Bad Request
        assert(error.message === null || error.message === 'UnknownError', `Error message does not match got: ${error.message}`);
        assert(error.Code === 'BadRequest' || error.Code === undefined, `Error code does not match got: ${error.Code}`);
        assert(error.$metadata.httpStatusCode === 500 || error.$metadata.httpStatusCode === 400, `Error status code does not match got: ${error.$metadata.httpStatusCode}`);
    }

    const head = await s3_client.getObject({
        Bucket: BKT,
        Key: FILE_NAME_COPY,
        SSECustomerAlgorithm: 'AES256',
        SSECustomerKey: SSECustomerKeyCopy,
    });

    const body_as_string = await head.Body.transformToString();
    assert.strictEqual(body_as_string, FILE_BODY);
    assert.strictEqual(head.ContentType, 'text/plain');
    assert.strictEqual(head.ContentLength, FILE_BODY.length);

    await s3_client.deleteObject({
        Bucket: BKT,
        Key: FILE_NAME,
    });

    await s3_client.deleteObject({
        Bucket: BKT,
        Key: FILE_NAME_COPY,
    });
}

async function copy(s3_client, BKT) {
    await s3_client.putObject({
        Bucket: BKT,
        Key: FILE_NAME,
        Body: FILE_BODY,
        ContentType: 'text/plain',
        SSECustomerAlgorithm: 'AES256',
        SSECustomerKey: SSECustomerKeyOrig,
    });

    await s3_client.copyObject({
        Bucket: BKT,
        CopySource: `/${BKT}/${FILE_NAME}`,
        Key: FILE_NAME_COPY,
        ContentType: 'text/plain',
        CopySourceSSECustomerAlgorithm: 'AES256',
        CopySourceSSECustomerKey: SSECustomerKeyOrig,
        SSECustomerAlgorithm: 'AES256',
        SSECustomerKey: SSECustomerKeyCopy,
    });

    try {
        const reply = await s3_client.headObject({
            Bucket: BKT,
            Key: FILE_NAME_COPY,
        });
        throw new Error(`Expected to get error with access without encryption keys ${reply}`);
    } catch (error) {
        // TODO: Should be this error: An error occurred (400) when calling the HeadObject operation: Bad Request
        assert(error.message === null || error.message === 'UnknownError', `Error message does not match got: ${error.message}`);
        assert(error.Code === 'BadRequest' || error.Code === undefined, `Error code does not match got: ${error.Code}`);
        assert(error.$metadata.httpStatusCode === 500 || error.$metadata.httpStatusCode === 400, `Error status code does not match got: ${error.$metadata.httpStatusCode}`);
    }

    try {
        const reply = await s3_client.headObject({
            Bucket: BKT,
            Key: FILE_NAME_COPY,
            SSECustomerAlgorithm: 'AES256',
            SSECustomerKey: SSECustomerKeyOrig,
        });
        throw new Error(`Expected to get error with access without old encryption keys ${reply}`);
    } catch (error) {
        // TODO: Should be this error: An error occurred (400) when calling the HeadObject operation: Bad Request
        assert(error.message === null || error.message === 'UnknownError', `Error message does not match got: ${error.message}`);
        assert(error.Code === 'BadRequest' || error.Code === undefined, `Error code does not match got: ${error.Code}`);
        assert(error.$metadata.httpStatusCode === 500 || error.$metadata.httpStatusCode === 400, `Error status code does not match got: ${error.$metadata.httpStatusCode}`);
    }

    const head = await s3_client.getObject({
        Bucket: BKT,
        Key: FILE_NAME_COPY,
        SSECustomerAlgorithm: 'AES256',
        SSECustomerKey: SSECustomerKeyCopy,
    });

    const body_as_string = await head.Body.transformToString();
    assert.strictEqual(body_as_string, FILE_BODY);
    assert.strictEqual(head.ContentType, 'text/plain');
    assert.strictEqual(head.ContentLength, FILE_BODY.length);

    await s3_client.deleteObject({
        Bucket: BKT,
        Key: FILE_NAME,
    });

    await s3_client.deleteObject({
        Bucket: BKT,
        Key: FILE_NAME_COPY,
    });
}
