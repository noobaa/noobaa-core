/* Copyright (C) 2016 NooBaa */
'use strict';
const _ = require('lodash');
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
    const AWS_SOURCE_BUCKET = 's3-ops-source';
    const { rpc_client, EMAIL } = coretest;
    const BKT1 = 'test-s3-ops-bucket-ops';
    const BKT2 = 'test-s3-ops-object-ops';
    const BKT3 = 'test2-s3-ops-object-ops';
    const BKT4 = 'test3-s3-ops-object-ops';
    const BKT5 = 'test5-s3-ops-objects-ops';
    const CONNECTION_NAME = 'aws_connection1';
    const CONNECTION_NAME1 = 'aws_connection2';

    const RESOURCE_NAME = 'namespace_target_bucket';
    const RESOURCE_NAME_SOURCE = 'namespace_source_bucket';
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
        const file_body2 = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
        const sliced_file_body = "TEXT-F";
        const sliced_file_body1 = "_COOL";
        const source_bucket = 's3-ops-source';
        const text_file1 = 'text-file1';
        const text_file2 = 'text-file2';
        const text_file3 = 'text-file3';
        const text_file5 = 'text-file5';
        mocha.before(async function() {
            this.timeout(100000); // eslint-disable-line no-invalid-this
            if (bucket_type === "regular") {
                await s3.createBucket({ Bucket: bucket_name }).promise();
            } else if (SKIP_TEST) {
                this.skip(); // eslint-disable-line no-invalid-this
            } else {
                const read_resources = [RESOURCE_NAME];
                const write_resource = RESOURCE_NAME;
                const read_resources1 = [RESOURCE_NAME_SOURCE];
                const write_resource1 = RESOURCE_NAME_SOURCE;
                const ENDPOINT = process.env.ENDPOINT ? process.env.ENDPOINT : 'https://s3.amazonaws.com';
                const ENDPOINT_TYPE = process.env.ENDPOINT_TYPE ? process.env.ENDPOINT_TYPE : 'AWS';

                    await rpc_client.account.add_external_connection({
                    name: CONNECTION_NAME,
                    endpoint: ENDPOINT,
                    endpoint_type: ENDPOINT_TYPE,
                    identity: process.env.AWS_ACCESS_KEY_ID,
                    secret: process.env.AWS_SECRET_ACCESS_KEY,
                });
                await rpc_client.pool.create_namespace_resource({
                    name: RESOURCE_NAME,
                    connection: CONNECTION_NAME,
                    target_bucket: AWS_TARGET_BUCKET
                });
                try {
                await rpc_client.pool.create_namespace_resource({
                    name: RESOURCE_NAME_SOURCE,
                    connection: CONNECTION_NAME,
                    target_bucket: AWS_SOURCE_BUCKET
                });
            } catch (err) {
                console.log(err);
            }

                try {
                    const namespace1 = {
                        read_resources: read_resources1,
                        write_resource: write_resource1,
                        caching: caching
                    };
                    await rpc_client.bucket.create_bucket({ name: source_bucket, namespace : namespace1});
                    }catch (err) {
                        console.log(err);
                    }
                await rpc_client.bucket.create_bucket({ name: bucket_name, namespace: { read_resources, write_resource, caching } });

                await s3.createBucket({ Bucket: BKT5 }).promise();
            }
            const rest = await s3.putObject({ Bucket: BKT5, Key: text_file5, Body: file_body2, ContentType: 'text/plain' }).promise();
            try {
                await s3.headObject({ Bucket: BKT5, Key: text_file5 }).promise();
            } catch (err) {
                console.log(err);
            }
            await s3.putObject({ Bucket: source_bucket, Key: text_file5, Body: file_body2, ContentType: 'text/plain' }).promise();
            await s3.putObject({ Bucket: bucket_name, Key: text_file1, Body: file_body, ContentType: 'text/plain' }).promise();
        });

        mocha.it('should head text-file', async function() {

            await s3.headObject({ Bucket: bucket_name, Key: text_file1 }).promise();
        });

        mocha.it('should version head text-file', async function() {
            if (caching) {
                try {
                    await s3.headObject({ Bucket: bucket_name, Key: text_file1, VersionId: "rasWWGpgk9E4s0LyTJgusGeRQKLVIAFf"}).promise();
                    throw new Error('version request should fail for cache buckets');
                } catch (error) {
                    assert.equal(error.statusCode, 501);
                }
           }
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
            console.log('sanjeev text file copy start');
            this.timeout(60000);
            const res1 = await s3.listObjects({ Bucket: bucket_name }).promise();
            await s3.copyObject({
                Bucket: bucket_name,
                Key: text_file2,
                CopySource: `/${bucket_name}/${text_file1}`,
            }).promise();
            const res2 = await s3.listObjects({ Bucket: bucket_name }).promise();
            assert(res2.Contents.length === (res1.Contents.length + 1),
                `bucket ${bucket_name} copy failed, expected: ${(res1.Contents.length + 1)}, found: ${(res2.Contents.length)}`);
                console.log('sanjeev text file copy end');
        });
        mocha.it('should multi-part copy text-file', async function() {
            // eslint-disable-next-line no-invalid-this
            this.timeout(600000);
            try {
                const res9 = await s3.headObject({ Bucket: BKT5, Key: text_file5 }).promise();
                console.log(res9);
            } catch (err) {
                console.log(err);
            }
            try {
            const res7 = await s3.listObjects({ Bucket: bucket_name }).promise();
            console.log(res7);
            const res8 = await s3.listObjects({ Bucket: BKT5 }).promise();
            console.log(res8);
            const res6 = await s3.headObject({ Bucket: BKT5, Key: text_file5 }).promise();
            console.log(res6);
             } catch (err) {
                console.log(err);
            }
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
            try {
            const res3 = await s3.uploadPartCopy({
                Bucket: bucket_name,
                Key: text_file2,
                UploadId: res1.UploadId,
                PartNumber: 2,
                CopySource: `/${source_bucket}/${text_file5}`,
                CopySourceRange: "bytes=1-5",
            }).promise();
        } catch (err) {
            console.log(err);
        }
            // list_uploads
            const res4 = await s3.listMultipartUploads({
                Bucket: bucket_name
            }).promise();
            var UploadId = _.result(_.find(res4.Uploads, function(obj) {
                return obj.UploadId === res1.UploadId;
            }), 'UploadId');
            assert.strictEqual(UploadId, res1.UploadId);
            // list_multiparts
            const res5 = await s3.listParts({
                Bucket: bucket_name,
                Key: text_file2,
                UploadId: res1.UploadId,
            }).promise();
            assert.strictEqual(res5.Parts, 2);
            assert.strictEqual(res5.Parts[0].Etag, res2.CopyPartResult.ETag);
            assert.strictEqual(res5.Parts[1].Etag, res5.CopyPartResult.ETag);
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
   /* mocha.describe('regular-bucket-object-ops', function() {
        test_object_ops(BKT2, "regular");
    });
    mocha.describe('namespace-bucket-object-ops', function() {
        test_object_ops(BKT3, "namespace");
    }); */
    mocha.describe('namespace-bucket-caching-enabled-object-ops', function() {
        test_object_ops(BKT4, "namespace", { ttl_ms: 60000 });
    });

});
