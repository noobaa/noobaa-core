/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup({ pools_to_create: coretest.POOL_LIST });

const AWS = require('aws-sdk');
const http = require('http');
const mocha = require('mocha');
const assert = require('assert');

const SKIP_TEST = !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY;

mocha.describe('s3_ops', function() {
    const AWS_TARGET_BUCKET = 's3-ops-test-bucket';

    const { rpc_client, EMAIL } = coretest;
    const BKT1 = 'test-s3-ops-bucket-ops';
    const BKT2 = 'test-s3-ops-object-ops';
    const BKT3 = 'test2-s3-ops-object-ops';

    const CONNECTION_NAME = 'aws_connection1';
    const RESOURCE_NAME = 'namespace_target_bucket';

    let s3;

    mocha.before(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);

        const account_info = await rpc_client.account.read_account({ email: EMAIL, });
        s3 = new AWS.S3({
            endpoint: coretest.get_http_address(),
            accessKeyId: account_info.access_keys[0].access_key.unwrap(),
            secretAccessKey: account_info.access_keys[0].secret_key.unwrap(),
            s3ForcePathStyle: true,
            signatureVersion: 'v4',
            computeChecksums: true,
            s3DisableBodySigning: false,
            region: 'us-east-1',
            httpOptions: { agent: new http.Agent({ keepAlive: false }) },
        });
        coretest.log('S3 CONFIG', s3.config);
    });

    mocha.describe('bucket-ops', function() {
        mocha.it('should create bucket', async function() {
            await s3.createBucket({ Bucket: BKT1 }).promise();
        });
        mocha.it('should not recreate bucket', async function() {
            const func = async () => s3.createBucket({ Bucket: BKT1 }).promise();
            const expected_err_props = {
                name: 'BucketAlreadyOwnedByYou',
                code: 'BucketAlreadyOwnedByYou',
                statusCode: 409,
            };
            await assert.rejects(func, expected_err_props);
        });
        mocha.it('should head bucket', async function() {
            await s3.headBucket({ Bucket: BKT1 }).promise();
        });
        mocha.it('should list buckets with one bucket', async function() {
            const res = await s3.listBuckets().promise();
            assert(res.Buckets.find(bucket => bucket.Name === BKT1));
        });
        mocha.it('should delete bucket', async function() {
            await s3.deleteBucket({ Bucket: BKT1 }).promise();
        });
        mocha.it('should list buckets after no buckets left', async function() {
            const res = await s3.listBuckets().promise();
            assert(!res.Buckets.find(bucket => bucket.Name === BKT1));
        });
    });

    function test_object_ops(bucket_name, bucket_type, caching) {
        const file_body = "TEXT-FILE-YAY!!!!-SO_COOL";
        const sliced_file_body = "TEXT-F";
        const sliced_file_body1 = "_COOL";

        const text_file1 = 'text-file1';
        const text_file2 = 'text-file2';
        mocha.before(async function() {
            this.timeout(10000); // eslint-disable-line no-invalid-this
            if (bucket_type === "regular") {
                await s3.createBucket({ Bucket: bucket_name }).promise();
            } else if (SKIP_TEST) {
                this.skip(); // eslint-disable-line no-invalid-this
            } else {
                const read_resources = [RESOURCE_NAME];
                const write_resource = RESOURCE_NAME;
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
                await rpc_client.bucket.create_bucket({ name: bucket_name, namespace: { read_resources, write_resource, caching } });
            }
            await s3.putObject({ Bucket: bucket_name, Key: text_file1, Body: file_body, ContentType: 'text/plain' }).promise();
        });
        mocha.it('should head text-file', async function() {
            await s3.headObject({ Bucket: bucket_name, Key: text_file1 }).promise();
        });
        mocha.it('should get text-file', async function() {
            const res = await s3.getObject({ Bucket: bucket_name, Key: text_file1 }).promise();
            assert.strictEqual(res.Body.toString(), file_body);
            assert.strictEqual(res.ContentType, 'text/plain');
            assert.strictEqual(res.ContentLength, file_body.length);
        });

        mocha.it('should get text-file sliced 1', async function() {
            const res = await s3.getObject({ Bucket: bucket_name, Key: text_file1, Range: 'bytes=0-5' }).promise();
            assert.strictEqual(res.Body.toString(), sliced_file_body);
            assert.strictEqual(res.ContentType, 'text/plain');
            assert.strictEqual(res.ContentLength, sliced_file_body.length);
        });

        mocha.it('should get text-file sliced 2', async function() {
            const res = await s3.getObject({ Bucket: bucket_name, Key: text_file1, Range: 'bytes=-5' }).promise();
            assert.strictEqual(res.Body.toString(), sliced_file_body1);
            assert.strictEqual(res.ContentType, 'text/plain');
            assert.strictEqual(res.ContentLength, sliced_file_body1.length);
        });

        mocha.it('should get text-file sliced 3', async function() {
            const res = await s3.getObject({ Bucket: bucket_name, Key: text_file1, Range: 'bytes=0-' }).promise();
            assert.strictEqual(res.Body.toString(), file_body);
            assert.strictEqual(res.ContentType, 'text/plain');
            assert.strictEqual(res.ContentLength, file_body.length);
        });
        mocha.it('should copy text-file', async function() {
            await s3.copyObject({
                Bucket: bucket_name,
                Key: text_file2,
                CopySource: `/${bucket_name}/${text_file1}`,
            }).promise();
        });
        mocha.it('should multi-part copy text-file', async function() {
            // eslint-disable-next-line no-invalid-this
            this.timeout(60000);
            const res1 = await s3.createMultipartUpload({
                Bucket: bucket_name,
                Key: text_file2
            }).promise();
            const res2 = await s3.uploadPartCopy({
                Bucket: bucket_name,
                Key: text_file2,
                UploadId: res1.UploadId,
                PartNumber: 1,
                CopySource: `/${bucket_name}/${text_file1}`,
                CopySourceRange: "bytes=1-5",
            }).promise();
            await s3.completeMultipartUpload({
                Bucket: bucket_name,
                Key: text_file2,
                UploadId: res1.UploadId,
                MultipartUpload: {
                    Parts: [{
                        ETag: res2.CopyPartResult.ETag,
                        PartNumber: 1
                    }]
                }
            }).promise();
        });
        mocha.it('should list objects with text-file', async function() {
            const res = await s3.listObjects({ Bucket: bucket_name }).promise();
            assert.strictEqual(res.Contents[0].Key, text_file1);
            assert.strictEqual(res.Contents[0].Size, file_body.length);
            assert.strictEqual(res.Contents[1].Key, text_file2);
            assert.strictEqual(res.Contents[1].Size, 5);
            assert.strictEqual(res.Contents.length, 2);
        });
        mocha.it('should delete text-file', async function() {
            // eslint-disable-next-line no-invalid-this
            this.timeout(60000);
            // await s3.deleteObjects({
            //     Bucket: bucket_name,
            //     Delete: {
            //         Objects: [{ Key: text_file1 }, { Key: text_file2 }]
            //     }
            // }).promise();
            await s3.deleteObject({
                Bucket: bucket_name,
                Key: text_file1,
            }).promise();
            await s3.deleteObject({
                Bucket: bucket_name,
                Key: text_file2,
            }).promise();
        });
        mocha.it('should list objects after no objects left', async function() {
            const res = await s3.listObjects({ Bucket: bucket_name }).promise();
            assert.strictEqual(res.Contents.length, 0);
        });
        mocha.after(async function() {
            if (SKIP_TEST) {
                coretest.log('No AWS credentials found in env. Skipping test');
                this.skip(); // eslint-disable-line no-invalid-this
            }
            if (bucket_type === "regular") {
                await s3.deleteBucket({ Bucket: bucket_name }).promise();
            } else {
                await rpc_client.bucket.delete_bucket({ name: bucket_name });
                await rpc_client.pool.delete_namespace_resource({
                    name: RESOURCE_NAME,
                });
                await rpc_client.account.delete_external_connection({
                    connection_name: CONNECTION_NAME,
                });
            }
        });
    }
    mocha.describe('regular-bucket-object-ops', function() {
        test_object_ops(BKT2, "regular");
    });
    mocha.describe('namespace-bucket-object-ops', function() {
        test_object_ops(BKT3, "namespace");
    });
    mocha.describe('namespace-bucket-caching-enabled-object-ops', function() {
        test_object_ops(BKT3, "namespace", { ttl_ms: 60000 });
    });

});
