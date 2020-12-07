/* Copyright (C) 2016 NooBaa */
/* eslint max-lines-per-function: ['error', 700] */
'use strict';
const _ = require('lodash');
// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup({ pools_to_create: coretest.POOL_LIST });
const config = require('../../../config');
const AWS = require('aws-sdk');
const http_utils = require('../../util/http_utils');
const mocha = require('mocha');
const assert = require('assert');
const querystring = require('querystring');
const P = require('../../util/promise');

// If any of these variables are not defined,
// use the noobaa endpoint to create buckets
// for namespace and namespace cache bucket testing.
const USE_REMOTE_ENDPOINT = process.env.USE_REMOTE_ENDPOINT === 'true';
const { rpc_client, EMAIL } = coretest;
const BKT1 = 'test-s3-ops-bucket-ops';
const BKT2 = 'test-s3-ops-object-ops';
const BKT3 = 'test2-s3-ops-object-ops';
const BKT4 = 'test3-s3-ops-object-ops';
const BKT5 = 'test5-s3-ops-objects-ops';
const CONNECTION_NAME = 's3_connection';
const NAMESPACE_RESOURCE_SOURCE = 'namespace_target_bucket';
const NAMESPACE_RESOURCE_TARGET = 'namespace_source_bucket';
const TARGET_BUCKET = 's3-ops-target';
const SOURCE_BUCKET = 's3-ops-source';
const file_body = "TEXT-FILE-YAY!!!!-SO_COOL";
const file_body2 = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const sliced_file_body = "TEXT-F";
const sliced_file_body1 = "_COOL";
const text_file1 = 'text-file1';
const text_file2 = 'text-file2';
const text_file3 = 'text-file3';
const text_file5 = 'text-file5';

mocha.describe('s3_ops', function() {

    let s3;
    // Bucket name for the source namespace resource
    let source_namespace_bucket;
    // Bucket name for the target namespace resource
    let target_namespace_bucket;
    let source_bucket;

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
            httpOptions: { agent: http_utils.get_unsecured_agent(coretest.get_http_address()) },
        });
        coretest.log('S3 CONFIG', s3.config);
    });

    mocha.describe('bucket-ops', function() {
        // eslint-disable-next-line no-invalid-this
        this.timeout(60000);
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

        mocha.before(async function() {
            this.timeout(100000); // eslint-disable-line no-invalid-this
            source_bucket = bucket_name + '-source';
            if (bucket_type === "regular") {
                await s3.createBucket({ Bucket: bucket_name }).promise();
                await s3.createBucket({ Bucket: source_bucket }).promise();
            } else {
                source_namespace_bucket = caching ? SOURCE_BUCKET + '-caching' : SOURCE_BUCKET;
                target_namespace_bucket = caching ? TARGET_BUCKET + '-caching' : TARGET_BUCKET;

                const ENDPOINT = USE_REMOTE_ENDPOINT ? process.env.ENDPOINT : coretest.get_https_address();
                const ENDPOINT_TYPE = USE_REMOTE_ENDPOINT ? process.env.ENDPOINT_TYPE : 'S3_COMPATIBLE';
                const AWS_ACCESS_KEY_ID = USE_REMOTE_ENDPOINT ? process.env.AWS_ACCESS_KEY_ID : s3.config.accessKeyId;
                const AWS_SECRET_ACCESS_KEY = USE_REMOTE_ENDPOINT ? process.env.AWS_SECRET_ACCESS_KEY : s3.config.secretAccessKey;

                coretest.log("Using endpoint: ", ENDPOINT);

                await rpc_client.account.add_external_connection({
                    name: CONNECTION_NAME,
                    endpoint: ENDPOINT,
                    endpoint_type: ENDPOINT_TYPE,
                    identity: AWS_ACCESS_KEY_ID,
                    secret: AWS_SECRET_ACCESS_KEY,
                });

                /**
                 * NOTE: Remote buckets are not created in the test. It is assumed that
                 * a. The buckets exist
                 * b. The buckets are empty
                 * Following buckets need to exist on the remote endpoint:
                 *
                 * s3-ops-source-caching
                 * s3-ops-target-caching
                 */
                if (!USE_REMOTE_ENDPOINT) {
                    // Create buckets for the source and target namespaces
                    await s3.createBucket({ Bucket: target_namespace_bucket }).promise();
                    await s3.createBucket({ Bucket: source_namespace_bucket }).promise();
                }
                await rpc_client.pool.create_namespace_resource({
                    name: NAMESPACE_RESOURCE_SOURCE,
                    connection: CONNECTION_NAME,
                    target_bucket: target_namespace_bucket
                });
                await rpc_client.pool.create_namespace_resource({
                    name: NAMESPACE_RESOURCE_TARGET,
                    connection: CONNECTION_NAME,
                    target_bucket: source_namespace_bucket
                });

                await rpc_client.bucket.create_bucket({
                    name: source_bucket,
                    namespace: {
                        read_resources: [NAMESPACE_RESOURCE_TARGET],
                        write_resource: NAMESPACE_RESOURCE_TARGET,
                        caching: caching
                    }
                });
                await rpc_client.bucket.create_bucket({
                    name: bucket_name,
                    namespace: {
                        read_resources: [NAMESPACE_RESOURCE_SOURCE],
                        write_resource: NAMESPACE_RESOURCE_SOURCE,
                        caching
                    }
                });
            }

            await s3.createBucket({
                Bucket: BKT5
            }).promise();

            await s3.putObject({
                Bucket: BKT5,
                Key: text_file5,
                Body: file_body2,
                ContentType: 'text/plain'
            }).promise();

            await s3.putObject({
                Bucket: source_bucket,
                Key: text_file5,
                Body: file_body2,
                ContentType: 'text/plain'
            }).promise();

            await s3.putObject({
                Bucket: bucket_name,
                Key: text_file1,
                Body: file_body,
                ContentType: 'text/plain'
            }).promise();

        });

        mocha.it('shoult tag text file', async function() {
            this.timeout(60000); // eslint-disable-line no-invalid-this
            const params = {
                Bucket: bucket_name,
                Key: text_file1,
                Tagging: {
                    TagSet: [{
                        Key: 's3ops',
                        Value: 'set_file_attribute'
                    }]
                }
            };
            let httpStatus;
            var notSupported = false;
            try {
                await s3.putObjectTagging(params).on('complete', function(response) {
                    httpStatus = response.httpResponse.statusCode;
                }).on('error', err => {
                    httpStatus = err.statusCode;
                    notSupported = true;
                }).promise();
                assert.strictEqual(httpStatus, 200, 'Should be 200');
            } catch (err) {
                assert.strictEqual(httpStatus, 500, 'Should be 200');
            }

            const query_params = { get_from_cache: true };
            const res = await s3.getObjectTagging({
                Bucket: bucket_name,
                Key: params.Key,
            }).on('build', req => {
                if (!caching) return;
                const sep = req.httpRequest.search() ? '&' : '?';
                const query_string = querystring.stringify(query_params);
                const req_path = `${req.httpRequest.path}${sep}${query_string}`;
                req.httpRequest.path = req_path;
            }).promise();
            assert.strictEqual(res.TagSet.length, notSupported ? 0 : params.Tagging.TagSet.length, 'Should be 1');

            if (!notSupported) {
                assert.strictEqual(res.TagSet[0].Key, params.Tagging.TagSet[0].Key, 'Should be s3ops');
                assert.strictEqual(res.TagSet[0].Value, params.Tagging.TagSet[0].Value, 'Should be s3ops');
            }
            try {
                await s3.deleteObjectTagging({
                    Bucket: bucket_name,
                    Key: params.Key,
                }).on('complete', function(response) {
                    httpStatus = response.httpResponse.statusCode;
                }).promise();
                assert.strictEqual(httpStatus, 204, 'Should be 200');
            } catch (err) {
                assert.strictEqual(httpStatus, 500, 'Should be 500');
            }
        });

        mocha.it('should head text-file', async function() {
            this.timeout(60000); // eslint-disable-line no-invalid-this
            const params = {
                Bucket: bucket_name,
                Key: text_file1,
                Tagging: {
                    TagSet: [{
                        Key: 's3ops',
                        Value: 'set_file_attribute'
                    }]
                }
            };
            let httpStatus;
            var notSupported = false;
            try {
                await s3.putObjectTagging(params).on('complete', function(response) {
                    httpStatus = response.httpResponse.statusCode;
                }).on('error', err => {
                    httpStatus = err.statusCode;
                    notSupported = true;
                }).promise();
                assert.strictEqual(httpStatus, 200, 'Should be 200');
            } catch (err) {
                assert.strictEqual(notSupported, true);
            }

            const query_params = { get_from_cache: true };
            const res = await s3.getObjectTagging({
                Bucket: bucket_name,
                Key: params.Key,
            }).on('build', req => {
                if (!caching) return;
                const sep = req.httpRequest.search() ? '&' : '?';
                const query_string = querystring.stringify(query_params);
                const req_path = `${req.httpRequest.path}${sep}${query_string}`;
                req.httpRequest.path = req_path;
            }).promise();
            assert.strictEqual(res.TagSet.length, notSupported ? 0 : params.Tagging.TagSet.length, 'Should be 1');

            if (!notSupported) {
                assert.strictEqual(res.TagSet[0].Key, params.Tagging.TagSet[0].Key, 'Should be s3ops');
                assert.strictEqual(res.TagSet[0].Value, params.Tagging.TagSet[0].Value, 'Should be s3ops');
            }
            try {
                await s3.deleteObjectTagging({
                    Bucket: bucket_name,
                    Key: params.Key,
                }).on('complete', function(response) {
                    httpStatus = response.httpResponse.statusCode;
                }).promise();
                assert.strictEqual(httpStatus, 204, 'Should be 200');
            } catch (err) {
                assert.strictEqual(httpStatus, 500, 'Should be 500');
            }
            await s3.headObject({ Bucket: bucket_name, Key: text_file1 }).promise();
        });

        mocha.it('should version head text-file', async function() {
            try {
                const query_params = { versionId: "rasWWGpgk9E4s0LyTJgusGeRQKLVIAFf" };
                await s3.headObject({ Bucket: bucket_name, Key: text_file1 }).on('build', req => {
                    if (!caching) return;
                    const sep = req.httpRequest.search() ? '&' : '?';
                    const query_string = querystring.stringify(query_params);
                    const req_path = `${req.httpRequest.path}${sep}${query_string}`;
                    req.httpRequest.path = req_path;
                }).promise();
                assert.notStrictEqual(caching, undefined, { statusCode: 400, text: 'Versioning not supported when caching is enabled' });
            } catch (err) {
                if (!(err instanceof assert.AssertionError)) {
                    assert.strictEqual(err.statusCode, 501);
                }
            }
        });

        mocha.it('should get text-file', async function() {
            const res = await s3.getObject({ Bucket: bucket_name, Key: text_file1 }).promise();
            assert.strictEqual(res.Body.toString(), file_body);
            assert.strictEqual(res.ContentType, 'text/plain');
            assert.strictEqual(res.ContentLength, file_body.length);
        });

        mocha.it('should get text-file with size > inline range', async function() {
            const ORIG_INLINE_MAX_SIZE = config.INLINE_MAX_SIZE;
            // Change the inline max size so the objects get cached.
            config.INLINE_MAX_SIZE = 1;
            const res = await s3.getObject({ Bucket: bucket_name, Key: text_file1 }).promise();
            config.INLINE_MAX_SIZE = ORIG_INLINE_MAX_SIZE;
            assert.strictEqual(res.Body.toString(), file_body);
            assert.strictEqual(res.ContentType, 'text/plain');
            assert.strictEqual(res.ContentLength, file_body.length);
        });

        mocha.it('should head text-file with size > inline range', async function() {
            const ORIG_INLINE_MAX_SIZE = config.INLINE_MAX_SIZE;
            // Change the inline max size so the objects get cached.
            config.INLINE_MAX_SIZE = 1;
            const res = await s3.headObject({ Bucket: bucket_name, Key: text_file1 }).promise();
            config.INLINE_MAX_SIZE = ORIG_INLINE_MAX_SIZE;
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
            this.timeout(120000); // eslint-disable-line no-invalid-this
            const res1 = await s3.listObjects({ Bucket: bucket_name }).promise();
            await s3.copyObject({
                Bucket: bucket_name,
                Key: text_file2,
                CopySource: `/${bucket_name}/${text_file1}`,
            }).promise();
            await s3.copyObject({
                Bucket: bucket_name,
                Key: text_file3,
                CopySource: `/${BKT5}/${text_file5}`,
            }).promise();
            const res2 = await s3.listObjects({ Bucket: bucket_name }).promise();
            assert.strictEqual(res2.Contents.length, (res1.Contents.length + 2));
        });
        mocha.it('should copy text-file multi-part', async function() {
            // eslint-disable-next-line no-invalid-this
            this.timeout(600000);

            const res1 = await s3.createMultipartUpload({
                Bucket: bucket_name,
                Key: text_file2
            }).promise();

            await s3.uploadPartCopy({
                Bucket: bucket_name,
                Key: text_file2,
                UploadId: res1.UploadId,
                PartNumber: 1,
                CopySource: `/${bucket_name}/${text_file1}`,
            }).promise();
            await s3.uploadPartCopy({
                Bucket: bucket_name,
                Key: text_file2,
                UploadId: res1.UploadId,
                PartNumber: 1,
                CopySource: `/${bucket_name}/${text_file1}`,
                CopySourceRange: "bytes=1-5",
            }).promise();
            await s3.uploadPartCopy({
                Bucket: bucket_name,
                Key: text_file2,
                UploadId: res1.UploadId,
                PartNumber: 1,
                CopySource: `/${BKT5}/${text_file5}`,
            }).promise();
            await s3.uploadPartCopy({
                Bucket: bucket_name,
                Key: text_file2,
                UploadId: res1.UploadId,
                PartNumber: 1,
                CopySource: `/${BKT5}/${text_file5}`,
                CopySourceRange: "bytes=1-5",
            }).promise();
            await s3.uploadPartCopy({
                Bucket: bucket_name,
                Key: text_file2,
                UploadId: res1.UploadId,
                PartNumber: 1,
                CopySource: `/${source_bucket}/${text_file5}`,
            }).promise();
            const res7 = await s3.uploadPartCopy({
                Bucket: bucket_name,
                Key: text_file2,
                UploadId: res1.UploadId,
                PartNumber: 1,
                CopySource: `/${source_bucket}/${text_file5}`,
                CopySourceRange: "bytes=1-5",
            }).promise();
            // list_uploads
            const res6 = await s3.listMultipartUploads({
                Bucket: bucket_name
            }).promise();
            var UploadId = _.result(_.find(res6.Uploads, function(obj) {
                return obj.UploadId === res1.UploadId;
            }), 'UploadId');
            assert.strictEqual(UploadId, res1.UploadId);
            // list_multiparts
            const res5 = await s3.listParts({
                Bucket: bucket_name,
                Key: text_file2,
                UploadId: res1.UploadId,
            }).promise();
            assert.strictEqual(res5.Parts.length, 1);
            assert.strictEqual(res5.Parts[0].ETag, res7.CopyPartResult.ETag);

            await s3.completeMultipartUpload({
                Bucket: bucket_name,
                Key: text_file2,
                UploadId: res1.UploadId,
                MultipartUpload: {
                    Parts: [{
                        ETag: res7.CopyPartResult.ETag,
                        PartNumber: 1
                    }]
                }
            }).promise();
        });
        mocha.it('should list objects with text-file', async function() {
            // eslint-disable-next-line no-invalid-this
            this.timeout(60000);
            const ORIG_INLINE_MAX_SIZE = config.INLINE_MAX_SIZE;
            // Change the inline max size so the objects get cached.
            if (caching) {
                config.INLINE_MAX_SIZE = 1;
            }

            const res1 = await s3.listObjects({ Bucket: bucket_name }).promise();
            // populate cache
            await s3.getObject({ Bucket: bucket_name, Key: text_file1 }).promise();
            await s3.getObject({ Bucket: bucket_name, Key: text_file2 }).promise();
            await s3.getObject({ Bucket: bucket_name, Key: text_file3 }).promise();

            assert.strictEqual(res1.Contents[0].Key, text_file1);
            assert.strictEqual(res1.Contents[0].Size, file_body.length);
            assert.strictEqual(res1.Contents.length, 3);

            if (!caching) return;
            const query_params = { get_from_cache: true };
            await P.delay(300);
            const res2 = await s3.listObjects({ Bucket: bucket_name }).on('build', req => {
                if (!caching) return;
                const sep = req.httpRequest.search() ? '&' : '?';
                const query_string = querystring.stringify(query_params);
                const req_path = `${req.httpRequest.path}${sep}${query_string}`;
                req.httpRequest.path = req_path;
            }).promise();

            assert.strictEqual(res2.Contents.length, 3);
            assert.strictEqual(res2.Contents[0].Key, text_file1);
            assert.strictEqual(res2.Contents[1].Key, text_file2);
            assert.strictEqual(res2.Contents[2].Key, text_file3);
            config.INLINE_MAX_SIZE = ORIG_INLINE_MAX_SIZE;
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
            await s3.deleteObject({ Bucket: BKT5, Key: text_file5 }).promise();
            await s3.deleteObject({ Bucket: source_bucket, Key: text_file5 }).promise();
            await s3.deleteObject({ Bucket: bucket_name, Key: text_file1 }).promise();
            await s3.deleteObject({ Bucket: bucket_name, Key: text_file2 }).promise();
            await s3.deleteObject({ Bucket: bucket_name, Key: text_file3 }).promise();
        });
        mocha.it('should list objects after no objects left', async function() {
            // eslint-disable-next-line no-invalid-this
            this.timeout(100000);
            const res = await s3.listObjects({ Bucket: bucket_name }).promise();
            assert.strictEqual(res.Contents.length, 0);
        });
        mocha.after(async function() {
            if (bucket_type === "regular") {
                await s3.deleteBucket({ Bucket: source_bucket }).promise();
                await s3.deleteBucket({ Bucket: bucket_name }).promise();
                await s3.deleteBucket({ Bucket: BKT5 }).promise();
            } else {
                if (!USE_REMOTE_ENDPOINT) {
                    await s3.deleteBucket({ Bucket: source_namespace_bucket }).promise();
                    await s3.deleteBucket({ Bucket: target_namespace_bucket }).promise();
                }
                await s3.deleteBucket({ Bucket: BKT5 }).promise();
                await rpc_client.bucket.delete_bucket({ name: bucket_name });
                await rpc_client.pool.delete_namespace_resource({ name: NAMESPACE_RESOURCE_SOURCE });

                await s3.deleteBucket({ Bucket: source_bucket }).promise();
                await rpc_client.pool.delete_namespace_resource({ name: NAMESPACE_RESOURCE_TARGET });
                await rpc_client.account.delete_external_connection({ connection_name: CONNECTION_NAME });
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
        test_object_ops(BKT4, "namespace", { ttl_ms: 60000 });
    });
});
