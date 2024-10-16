/* Copyright (C) 2016 NooBaa */
/* eslint-disable max-lines-per-function */
/* eslint-disable no-invalid-this */

'use strict';
const _ = require('lodash');
// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup({ pools_to_create: coretest.POOL_LIST });
const config = require('../../../config');
const { S3 } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const http_utils = require('../../util/http_utils');
const mocha = require('mocha');
const assert = require('assert');
const P = require('../../util/promise');
const azure_storage = require('@azure/storage-blob');

// If any of these variables are not defined,
// use the noobaa endpoint to create buckets
// for namespace cache bucket testing.
const USE_REMOTE_ENDPOINT = process.env.USE_REMOTE_ENDPOINT === 'true';
const { rpc_client, EMAIL } = coretest;
const BKT1 = 'test-s3-ops-bucket-ops';
const BKT2 = 'test-s3-ops-object-ops';
const BKT3 = 'test2-s3-ops-object-ops';
const BKT4 = 'test3-s3-ops-object-ops';
const BKT5 = 'test5-s3-ops-objects-ops';
const BKT6 = 'test6-s3-ops-object-ops';
const BKT7 = 'test7-s3-ops-objects-ops';
const CONNECTION_NAME = 's3_connection';
const CONNECTION_NAME_OTHER_PLATFORM = 's3_connection_other_platform';
const NAMESPACE_RESOURCE_SOURCE = 'namespace_target_bucket';
const NAMESPACE_RESOURCE_TARGET = 'namespace_source_bucket';
const NAMESPACE_RESOURCE_OTHER_PLATFORM = 'namespace_other_platform_bucket';
const TARGET_BUCKET = 's3-ops-target'; // these 2 buckets should exist in the external cloud provider before running the test
const SOURCE_BUCKET = 's3-ops-source';
const file_body = "TEXT-FILE-YAY!!!!-SO_COOL";
const file_body2 = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const sliced_file_body = "TEXT-F";
const sliced_file_body1 = "_COOL";
const text_file1 = 'text-file1';
const text_file2 = 'text-file2';
const text_file3 = 'text-file3';
const text_file5 = 'text-file5';

// azurite mock constants
const blob_mock_host = process.env.BLOB_HOST;
const azure_mock_account = 'devstoreaccount1';
const azure_mock_key = 'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';
const azure_mock_endpoint = `http://${blob_mock_host}:10000/${azure_mock_account}`;
const azure_mock_connection_string = `DefaultEndpointsProtocol=http;AccountName=${azure_mock_account};AccountKey=${azure_mock_key};BlobEndpoint=${azure_mock_endpoint};`;

mocha.describe('s3_ops', function() {

    /** @type {S3} */
    let s3;
    let s3_client_params;
    // Bucket name for the source namespace resource
    let source_namespace_bucket;
    // Bucket name for the target namespace resource
    let target_namespace_bucket;
    let source_bucket;
    let other_platform_bucket;
    let is_other_platform_bucket_created = false;
    const logging = {
        TargetBucket: BKT2,
        TargetPrefix: BKT1 + '/',
    };

    mocha.before(async function() {
        const self = this;
        self.timeout(60000);

        const account_info = await rpc_client.account.read_account({ email: EMAIL, });
        s3_client_params = {
            endpoint: coretest.get_http_address(),
            credentials: {
                accessKeyId: account_info.access_keys[0].access_key.unwrap(),
                secretAccessKey: account_info.access_keys[0].secret_key.unwrap(),
            },
            forcePathStyle: true,
            region: config.DEFAULT_REGION,
            requestHandler: new NodeHttpHandler({
                httpAgent: http_utils.get_unsecured_agent(coretest.get_http_address()),
            }),
        };
        s3 = new S3(s3_client_params);
        coretest.log('S3 CONFIG', s3.config);
    });

    mocha.describe('bucket-ops', function() {
        this.timeout(60000);
        mocha.it('should create bucket', async function() {
            await s3.createBucket({ Bucket: BKT1 });
        });
        mocha.it('should not recreate bucket', async function() {
            try {
                await s3.createBucket({ Bucket: BKT1 });
                assert.fail('should not recreate bucket');
            } catch (err) {
                assert.strictEqual(err.Code, 'BucketAlreadyOwnedByYou');
                assert.strictEqual(err.$metadata.httpStatusCode, 409);
            }
        });
        mocha.it('should head bucket', async function() {
            await s3.headBucket({ Bucket: BKT1 });
        });
        mocha.it('should list buckets with one bucket', async function() {
            const res = await s3.listBuckets({});
            assert(res.Buckets.find(bucket => bucket.Name === BKT1));
        });
        mocha.it('should enable bucket logging', async function() {
            await s3.createBucket({ Bucket: BKT2 });
            await s3.putBucketLogging({
                Bucket: BKT1,
                BucketLoggingStatus: {
                    LoggingEnabled: logging
                },
            });
            const res_logging = await s3.getBucketLogging({ Bucket: BKT1 });
            assert.equal(res_logging.$metadata.httpStatusCode, 200);
            assert.deepEqual(res_logging.LoggingEnabled, logging);
        });
        mocha.it('should fail to enable bucket logging', async function() {
            await s3.deleteBucket({ Bucket: BKT2 });
            try {
                await s3.putBucketLogging({
                    Bucket: BKT1,
                    BucketLoggingStatus: {
                        LoggingEnabled: logging
                    },
                });
                assert.fail('should not set bucket logging');
            } catch (err) {
                assert.strictEqual(err.Code, 'InvalidTargetBucketForLogging');
                assert.strictEqual(err.$metadata.httpStatusCode, 400);
            }
        });
        mocha.it('should disable bucket logging', async function() {
            await s3.putBucketLogging({
                Bucket: BKT1,
                BucketLoggingStatus: {},
            });
            const res_logging = await s3.getBucketLogging({ Bucket: BKT1 });
            assert.equal(res_logging.$metadata.httpStatusCode, 200);
            assert.equal(res_logging.LoggingEnabled, null);
        });
        mocha.it('should delete bucket', async function() {
            await s3.deleteBucket({ Bucket: BKT1 });
        });
        mocha.it('should list buckets after no buckets left', async function() {
            const res = await s3.listBuckets({});
            assert(!res.Buckets.find(bucket => bucket.Name === BKT1));
        });

        // Test that bucket_deletion is not allowed for an obc account
        mocha.it('OBC account should not be allowed to delete a bucket', async function() {
            // create the bucket to be deleted. use rpc to create, which is the same flow as the operator does
            await rpc_client.bucket.create_bucket({ name: "obc-bucket" });
            // create an obc account that is the bucket_claim_owner of the bucket
            const obc_account = await rpc_client.account.create_account({
                name: "obc-account",
                email: "obc-account@noobaa.io",
                has_login: false,
                s3_access: true,
                bucket_claim_owner: "obc-bucket",
            });
            const obc_s3_client = new S3({
                endpoint: coretest.get_http_address(),
                credentials: {
                    accessKeyId: obc_account.access_keys[0].access_key.unwrap(),
                    secretAccessKey: obc_account.access_keys[0].secret_key.unwrap(),
                },
                forcePathStyle: true,
                region: config.DEFAULT_REGION,
                requestHandler: new NodeHttpHandler({
                    httpAgent: http_utils.get_unsecured_agent(coretest.get_http_address()),
                }),
            });
            try {
                await obc_s3_client.deleteBucket({ Bucket: "obc-bucket" });
                assert.fail('expected AccessDenied error. bucket deletion should not be allowed for obc account');
            } catch (err) {
                assert.strictEqual(err.Code, 'AccessDenied');
                assert.strictEqual(err.$metadata.httpStatusCode, 403);
            }

            try {
                // bucket deletion should be allowed for regular accounts (not obc)
                await s3.deleteBucket({ Bucket: "obc-bucket" });
            } catch (err) {
                assert.fail('expected bucket deletion to be successful for regular accounts');
            }
            // cleanup
            await rpc_client.account.delete_account({ email: "obc-account@noobaa.io" });
        });


        mocha.describe('bucket-lifecycle', function() {

            mocha.before(async function() {
                await s3.createBucket({ Bucket: "lifecycle-bucket" });
            });

            mocha.it('should put and get bucket lifecycle with Prefix', async function() {

                // put bucket lifecycle
                const params = {
                    Bucket: "lifecycle-bucket",
                    LifecycleConfiguration: {
                        Rules: [{
                            ID: 'rule1',
                            Status: 'Enabled',
                            Prefix: 'prefix1-prefix',
                            Expiration: {
                                Days: 1
                            }
                        }]
                    }
                };
                await s3.putBucketLifecycleConfiguration(params);

                // get` bucket lifecycle
                const res = await s3.getBucketLifecycleConfiguration({ Bucket: "lifecycle-bucket" });
                assert.strictEqual(res.Rules.length, 1);
                assert.strictEqual(res.Rules[0].ID, 'rule1');
                assert.strictEqual(res.Rules[0].Status, 'Enabled');
                assert.strictEqual(res.Rules[0].Prefix, 'prefix1-prefix');
                assert.strictEqual(res.Rules[0].Expiration.Days, 1);
            });

            mocha.it('should put and get bucket lifecycle with Filter', async function() {
                // put bucket lifecycle
                const params = {
                    Bucket: "lifecycle-bucket",
                    LifecycleConfiguration: {
                        Rules: [{
                            ID: 'rule1',
                            Status: 'Enabled',
                            Filter: {
                                And: {
                                    Prefix: 'prefix1',
                                    Tags: [{
                                        Key: 'key1',
                                        Value: 'value1'
                                    }]
                                }
                            },
                            Expiration: {
                                Days: 1
                            }
                        }]
                    }
                };
                await s3.putBucketLifecycleConfiguration(params);

                // get bucket lifecycle
                const res = await s3.getBucketLifecycleConfiguration({ Bucket: "lifecycle-bucket" });
                assert.strictEqual(res.Rules.length, 1);
                assert.strictEqual(res.Rules[0].ID, 'rule1');
                assert.strictEqual(res.Rules[0].Status, 'Enabled');
                assert.strictEqual(res.Rules[0].Filter.And.Prefix, 'prefix1');
                assert.strictEqual(res.Rules[0].Filter.And.Tags[0].Key, 'key1');
                assert.strictEqual(res.Rules[0].Filter.And.Tags[0].Value, 'value1');
                assert.strictEqual(res.Rules[0].Expiration.Days, 1);
            });

            mocha.it('should put and get bucket lifecycle with Transitions', async function() {
                // put bucket lifecycle
                const params = {
                    Bucket: "lifecycle-bucket",
                    LifecycleConfiguration: {
                        Rules: [{
                            ID: 'rule1',
                            Status: 'Enabled',
                            Prefix: 'prefix1-transition',
                            Transitions: [{
                                Days: 1,
                                StorageClass: 'STANDARD_IA'
                            }]
                        }]
                    }
                };
                await s3.putBucketLifecycleConfiguration(params);

                // get bucket lifecycle
                const res = await s3.getBucketLifecycleConfiguration({ Bucket: "lifecycle-bucket" });
                assert.strictEqual(res.Rules.length, 1);
                assert.strictEqual(res.Rules[0].ID, 'rule1');
                assert.strictEqual(res.Rules[0].Status, 'Enabled');
                assert.strictEqual(res.Rules[0].Prefix, 'prefix1-transition');
                assert.strictEqual(res.Rules[0].Transitions[0].Days, 1);
                assert.strictEqual(res.Rules[0].Transitions[0].StorageClass, 'STANDARD_IA');
            });

            mocha.it('should put and get bucket lifecycle with NoncurrentVersionTransition', async function() {
                // put bucket lifecycle
                const params = {
                    Bucket: "lifecycle-bucket",
                    LifecycleConfiguration: {
                        Rules: [{
                            ID: 'rule1',
                            Status: 'Enabled',
                            Prefix: 'prefix1-noncurrent-version-transition',
                            NoncurrentVersionTransitions: [{
                                NoncurrentDays: 1,
                                StorageClass: 'STANDARD_IA'
                            }]
                        }]
                    }
                };
                await s3.putBucketLifecycleConfiguration(params);

                // get bucket lifecycle
                const res = await s3.getBucketLifecycleConfiguration({ Bucket: "lifecycle-bucket" });
                assert.strictEqual(res.Rules.length, 1);
                assert.strictEqual(res.Rules[0].ID, 'rule1');
                assert.strictEqual(res.Rules[0].Status, 'Enabled');
                assert.strictEqual(res.Rules[0].Prefix, 'prefix1-noncurrent-version-transition');
                assert.strictEqual(res.Rules[0].NoncurrentVersionTransitions[0].NoncurrentDays, 1);
                assert.strictEqual(res.Rules[0].NoncurrentVersionTransitions[0].StorageClass, 'STANDARD_IA');
            });

            mocha.it('should put and get bucket lifecycle with AbortIncompleteMultipartUpload', async function() {
                // put bucket lifecycle
                const params = {
                    Bucket: "lifecycle-bucket",
                    LifecycleConfiguration: {
                        Rules: [{
                            ID: 'rule1',
                            Status: 'Enabled',
                            Prefix: 'prefix1-abort-incomplete',
                            AbortIncompleteMultipartUpload: {
                                DaysAfterInitiation: 1
                            }
                        }]
                    }
                };
                await s3.putBucketLifecycleConfiguration(params);

                // get bucket lifecycle
                const res = await s3.getBucketLifecycleConfiguration({ Bucket: "lifecycle-bucket" });
                assert.strictEqual(res.Rules.length, 1);
                assert.strictEqual(res.Rules[0].ID, 'rule1');
                assert.strictEqual(res.Rules[0].Status, 'Enabled');
                assert.strictEqual(res.Rules[0].Prefix, 'prefix1-abort-incomplete');
                assert.strictEqual(res.Rules[0].AbortIncompleteMultipartUpload.DaysAfterInitiation, 1);

            });

            mocha.it('should put and get bucket lifecycle with Expiration', async function() {
                // put bucket lifecycle
                const params = {
                    Bucket: "lifecycle-bucket",
                    LifecycleConfiguration: {
                        Rules: [{
                            ID: 'rule1',
                            Status: 'Enabled',
                            Prefix: 'prefix1-expiration',
                            Expiration: {
                                Days: 1
                            }
                        }]
                    }
                };
                await s3.putBucketLifecycleConfiguration(params);

                // get bucket lifecycle
                const res = await s3.getBucketLifecycleConfiguration({ Bucket: "lifecycle-bucket" });
                assert.strictEqual(res.Rules.length, 1);
                assert.strictEqual(res.Rules[0].ID, 'rule1');
                assert.strictEqual(res.Rules[0].Status, 'Enabled');
                assert.strictEqual(res.Rules[0].Prefix, 'prefix1-expiration');
                assert.strictEqual(res.Rules[0].Expiration.Days, 1);
            });

            mocha.it('should put and get bucket lifecycle with NoncurrentVersionExpiration', async function() {
                // put bucket lifecycle
                const params = {
                    Bucket: "lifecycle-bucket",
                    LifecycleConfiguration: {
                        Rules: [{
                            ID: 'rule1',
                            Status: 'Enabled',
                            Filter: {
                                Prefix: 'prefix1-noncurrent-version-expiration'
                            },
                            NoncurrentVersionExpiration: {
                                NoncurrentDays: 1
                            }
                        }]
                    }
                };
                await s3.putBucketLifecycleConfiguration(params);

                // get bucket lifecycle
                const res = await s3.getBucketLifecycleConfiguration({ Bucket: "lifecycle-bucket" });
                assert.strictEqual(res.Rules.length, 1);
                assert.strictEqual(res.Rules[0].ID, 'rule1');
                assert.strictEqual(res.Rules[0].Status, 'Enabled');
                assert.strictEqual(res.Rules[0].Filter.Prefix, 'prefix1-noncurrent-version-expiration');
                assert.strictEqual(res.Rules[0].NoncurrentVersionExpiration.NoncurrentDays, 1);
            });

            mocha.after(async function() {
                await s3.deleteBucket({ Bucket: "lifecycle-bucket" });
            });

        });
    });

    async function test_object_ops(bucket_name, bucket_type, caching, remote_endpoint_options) {

        const is_azure_namespace = is_namespace_blob_bucket(bucket_type, remote_endpoint_options && remote_endpoint_options.endpoint_type);
        const is_azure_mock = is_namespace_blob_mock(bucket_type, remote_endpoint_options && remote_endpoint_options.endpoint_type);

        mocha.before(async function() {
            this.timeout(100000);
            source_bucket = bucket_name + '-source';
            other_platform_bucket = bucket_name + '-other-platform';
            if (bucket_type === "regular") {
                await s3.createBucket({ Bucket: bucket_name });
                await s3.createBucket({ Bucket: source_bucket });
                //create aws bucket to test copy from other server
                if (process.env.NEWAWSPROJKEY && process.env.NEWAWSPROJSECRET) {
                    source_namespace_bucket = caching ? SOURCE_BUCKET + '-caching' : SOURCE_BUCKET;
                    await rpc_client.account.add_external_connection({
                        endpoint: 'https://s3.amazonaws.com',
                        endpoint_type: 'AWS',
                        identity: process.env.NEWAWSPROJKEY,
                        secret: process.env.NEWAWSPROJSECRET,
                        name: CONNECTION_NAME_OTHER_PLATFORM
                    });
                    await rpc_client.pool.create_namespace_resource({
                        name: NAMESPACE_RESOURCE_OTHER_PLATFORM,
                        connection: CONNECTION_NAME_OTHER_PLATFORM,
                        target_bucket: source_namespace_bucket // use source_namespace_bucket as it should already exist
                    });
                    const trgt_nsr = { resource: NAMESPACE_RESOURCE_OTHER_PLATFORM };
                    await rpc_client.bucket.create_bucket({
                        name: other_platform_bucket,
                        namespace: {
                            read_resources: [trgt_nsr],
                            write_resource: trgt_nsr,
                            caching: caching
                        }
                    });
                    is_other_platform_bucket_created = true;
                }
            } else {
                source_namespace_bucket = caching ? SOURCE_BUCKET + '-caching' : SOURCE_BUCKET;
                target_namespace_bucket = caching ? TARGET_BUCKET + '-caching' : TARGET_BUCKET;

                const ENDPOINT = USE_REMOTE_ENDPOINT ? process.env.ENDPOINT : coretest.get_https_address();
                const ENDPOINT_TYPE = USE_REMOTE_ENDPOINT ? process.env.ENDPOINT_TYPE : 'S3_COMPATIBLE';
                const AWS_ACCESS_KEY_ID = USE_REMOTE_ENDPOINT ? process.env.AWS_ACCESS_KEY_ID : s3_client_params.credentials.accessKeyId;
                const AWS_SECRET_ACCESS_KEY = USE_REMOTE_ENDPOINT ? process.env.AWS_SECRET_ACCESS_KEY :
                    s3_client_params.credentials.secretAccessKey;
                coretest.log("before creating azure target bucket: ", source_namespace_bucket, target_namespace_bucket);
                if (is_azure_mock) {
                    coretest.log("creating azure target bucket: ", source_namespace_bucket, target_namespace_bucket);
                    // create containers only on mock usage
                    const blob_service = azure_storage.BlobServiceClient.fromConnectionString(azure_mock_connection_string);
                    await blob_service.createContainer(TARGET_BUCKET);
                    await blob_service.createContainer(SOURCE_BUCKET);
                }
                coretest.log("after creating azure target bucket: Using endpoint: ", ENDPOINT);
                const ns_remote_conn = remote_endpoint_options && { ...remote_endpoint_options, name: CONNECTION_NAME };
                await rpc_client.account.add_external_connection(ns_remote_conn || {
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
                    await s3.createBucket({ Bucket: target_namespace_bucket });
                    await s3.createBucket({ Bucket: source_namespace_bucket });
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
                const trgt_nsr = { resource: NAMESPACE_RESOURCE_TARGET };
                await rpc_client.bucket.create_bucket({
                    name: source_bucket,
                    namespace: {
                        read_resources: [trgt_nsr],
                        write_resource: trgt_nsr,
                        caching: caching
                    }
                });
                const src_nsr = { resource: NAMESPACE_RESOURCE_SOURCE };
                await rpc_client.bucket.create_bucket({
                    name: bucket_name,
                    namespace: {
                        read_resources: [src_nsr],
                        write_resource: src_nsr,
                        caching
                    }
                });
                await s3.createBucket({
                    Bucket: other_platform_bucket
                });
                is_other_platform_bucket_created = true;
            }

            await s3.createBucket({
                Bucket: BKT5
            });

            await s3.putObject({
                Bucket: BKT5,
                Key: text_file5,
                Body: file_body2,
                ContentType: 'text/plain'
            });

            await s3.putObject({
                Bucket: source_bucket,
                Key: text_file5,
                Body: file_body2,
                ContentType: 'text/plain'
            });

            await s3.putObject({
                Bucket: bucket_name,
                Key: text_file1,
                Body: file_body,
                ContentType: 'text/plain'
            });

            if (is_other_platform_bucket_created) {
                await s3.putObject({
                    Bucket: other_platform_bucket,
                    Key: text_file1,
                    Body: file_body,
                    ContentType: 'text/plain',
                });
            }

        });
        mocha.beforeEach('s3 ops before each', async function() {
            this.timeout(100000);
        });
        mocha.it('should tag text file', async function() {
            this.timeout(60000);
            if (is_azure_namespace) this.skip();
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
            let res;
            let httpStatus;
            let notSupported = false;

            try {
                res = await s3.putObjectTagging(params);
                httpStatus = res.$metadata.httpStatusCode;
                assert.strictEqual(httpStatus, 200, 'Should be 200');
            } catch (err) {
                notSupported = true;
                httpStatus = err.$metadata.httpStatusCode;
                assert.strictEqual(httpStatus, 500, 'Should be 200');
            }

            const params_req = {
                Bucket: bucket_name,
                Key: params.Key,
            };
            if (caching) {
                s3.middlewareStack.add(next => args => {
                    args.request.query.get_from_cache = 'true'; // represents query_params = { get_from_cache: true }
                    return next(args);
                }, { step: 'build', name: 'getFromCache' });
                res = await s3.getObjectTagging(params_req);
                s3.middlewareStack.remove('getFromCache');
            } else {
                res = await s3.getObjectTagging(params_req);
            }

            if (notSupported) {
                assert.strictEqual(res.TagSet, undefined);
            } else {
                assert.strictEqual(res.TagSet.length, params.Tagging.TagSet.length, 'Should be 1');
                assert.strictEqual(res.TagSet[0].Key, params.Tagging.TagSet[0].Key, 'Should be s3ops');
                assert.strictEqual(res.TagSet[0].Value, params.Tagging.TagSet[0].Value, 'Should be set_file_attribute');
            }
            try {
                res = await s3.deleteObjectTagging({
                    Bucket: bucket_name,
                    Key: params.Key,
                });
                httpStatus = res.$metadata.httpStatusCode;
                assert.strictEqual(httpStatus, 204, 'Should be 200');
            } catch (err) {
                httpStatus = err.$metadata.httpStatusCode;
                assert.strictEqual(httpStatus, 500, 'Should be 500');
            }
        });

        mocha.it('should head text-file', async function() {
            this.timeout(60000);
            if (!is_azure_namespace) {

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
                let notSupported = false;
                let res;

                try {
                    res = await s3.putObjectTagging(params);
                    httpStatus = res.$metadata.httpStatusCode;
                    assert.strictEqual(httpStatus, 200, 'Should be 200');
                } catch (err) {
                    httpStatus = err.$metadata.httpStatusCode;
                    notSupported = true;
                    assert.strictEqual(httpStatus, 500, 'Should be 200');
                }

                const params_req = {
                    Bucket: bucket_name,
                    Key: params.Key,
                };
                if (caching) {
                    s3.middlewareStack.add(next => args => {
                        args.request.query.get_from_cache = 'true'; // represents query_params = { get_from_cache: true }
                        return next(args);
                    }, { step: 'build', name: 'getFromCache' });
                    res = await s3.getObjectTagging(params_req);
                    s3.middlewareStack.remove('getFromCache');
                } else {
                    res = await s3.getObjectTagging(params_req);
                }
                if (notSupported) {
                    assert.strictEqual(res.TagSet, undefined);
                } else {
                    assert.strictEqual(res.TagSet.length, params.Tagging.TagSet.length, 'Should be 1');
                    assert.strictEqual(res.TagSet[0].Key, params.Tagging.TagSet[0].Key, 'Should be s3ops');
                    assert.strictEqual(res.TagSet[0].Value, params.Tagging.TagSet[0].Value, 'Should be set_file_attribute');
                }

                try {
                    res = await s3.deleteObjectTagging({
                        Bucket: bucket_name,
                        Key: params.Key,
                    });
                    httpStatus = res.$metadata.httpStatusCode;
                    assert.strictEqual(httpStatus, 204, 'Should be 200');
                } catch (err) {
                    httpStatus = err.$metadata.httpStatusCode;
                    assert.strictEqual(httpStatus, 500, 'Should be 500');
                }
            }
            await s3.headObject({ Bucket: bucket_name, Key: text_file1 });
        });

        mocha.it('should version head text-file', async function() {
            try {
                const params_req = {
                    Bucket: bucket_name,
                    Key: text_file1,
                };
                if (caching) params_req.vesionId = 'rasWWGpgk9E4s0LyTJgusGeRQKLVIAFf';
                await s3.headObject(params_req);
                assert.notStrictEqual(caching, undefined, 'Versioning not supported when caching is enabled');
            } catch (err) {
                if (!(err instanceof assert.AssertionError)) {
                    const statusCode = err.$metadata.httpStatusCode;
                    assert.strictEqual(statusCode, 501);
                }
            }
        });

        mocha.it('should get text-file', async function() {
            this.timeout(100000);
            const res = await s3.getObject({ Bucket: bucket_name, Key: text_file1 });
            const body_as_string = await res.Body.transformToString();
            assert.strictEqual(body_as_string, file_body);
            assert.strictEqual(res.ContentType, 'text/plain');
            assert.strictEqual(res.ContentLength, file_body.length);
        });

        mocha.it('should get text-file with size > inline range', async function() {
            this.timeout(100000);
            const ORIG_INLINE_MAX_SIZE = config.INLINE_MAX_SIZE;
            // Change the inline max size so the objects get cached.
            config.INLINE_MAX_SIZE = 1;
            const res = await s3.getObject({ Bucket: bucket_name, Key: text_file1 });
            config.INLINE_MAX_SIZE = ORIG_INLINE_MAX_SIZE;
            const body_as_string = await res.Body.transformToString();
            assert.strictEqual(body_as_string, file_body);
            assert.strictEqual(res.ContentType, 'text/plain');
            assert.strictEqual(res.ContentLength, file_body.length);
        });

        mocha.it('should head text-file with size > inline range', async function() {
            this.timeout(100000);
            const ORIG_INLINE_MAX_SIZE = config.INLINE_MAX_SIZE;
            // Change the inline max size so the objects get cached.
            config.INLINE_MAX_SIZE = 1;
            const res = await s3.headObject({ Bucket: bucket_name, Key: text_file1 });
            config.INLINE_MAX_SIZE = ORIG_INLINE_MAX_SIZE;
            assert.strictEqual(res.ContentType, 'text/plain');
            assert.strictEqual(res.ContentLength, file_body.length);
        });

        mocha.it('should get text-file sliced 1', async function() {
            const res = await s3.getObject({ Bucket: bucket_name, Key: text_file1, Range: 'bytes=0-5' });
            const body_as_string = await res.Body.transformToString();
            assert.strictEqual(body_as_string, sliced_file_body);
            assert.strictEqual(res.ContentType, 'text/plain');
            assert.strictEqual(res.ContentLength, sliced_file_body.length);
        });

        mocha.it('should get text-file sliced 2', async function() {
            this.timeout(100000);
            const res = await s3.getObject({ Bucket: bucket_name, Key: text_file1, Range: 'bytes=-5' });
            const body_as_string = await res.Body.transformToString();
            assert.strictEqual(body_as_string, sliced_file_body1);
            assert.strictEqual(res.ContentType, 'text/plain');
            assert.strictEqual(res.ContentLength, sliced_file_body1.length);
        });

        mocha.it('should get text-file sliced 3', async function() {
            this.timeout(120000);
            const res = await s3.getObject({ Bucket: bucket_name, Key: text_file1, Range: 'bytes=0-' });
            const body_as_string = await res.Body.transformToString();
            assert.strictEqual(body_as_string, file_body);
            assert.strictEqual(res.ContentType, 'text/plain');
            assert.strictEqual(res.ContentLength, file_body.length);
        });

        mocha.it('should copy text-file', async function() {
            if (is_azure_mock) this.skip();
            this.timeout(120000);
            const res1 = await s3.listObjects({ Bucket: bucket_name });
            await s3.copyObject({
                Bucket: bucket_name,
                Key: text_file2,
                CopySource: `/${bucket_name}/${text_file1}`,
            });
            await s3.copyObject({
                Bucket: bucket_name,
                Key: text_file3,
                CopySource: `/${BKT5}/${text_file5}`,
            });
            const res2 = await s3.listObjects({ Bucket: bucket_name });
            assert.strictEqual(res2.Contents.length, (res1.Contents.length + 2));
        });

        mocha.it('list-objects should return proper object owner and id', async function() {
            if (is_azure_mock) this.skip();
            this.timeout(120000);
            await s3.copyObject({
                Bucket: bucket_name,
                Key: text_file2,
                CopySource: `/${bucket_name}/${text_file1}`,
            });
            await s3.copyObject({
                Bucket: bucket_name,
                Key: text_file3,
                CopySource: `/${BKT5}/${text_file5}`,
            });
            const res = await s3.listObjects({ Bucket: bucket_name });

            assert.strictEqual(res.Contents[0].Key, text_file1);
            assert.strictEqual(res.Contents[0].Owner.DisplayName, "coretest@noobaa.com");
            assert.notEqual(res.Contents[0].Owner.ID, undefined);

            assert.strictEqual(res.Contents[1].Key, text_file2);
            assert.strictEqual(res.Contents[1].Owner.DisplayName, "coretest@noobaa.com");
            assert.notEqual(res.Contents[1].Owner.ID, undefined);

            assert.strictEqual(res.Contents[2].Key, text_file3);
            assert.strictEqual(res.Contents[2].Owner.DisplayName, "coretest@noobaa.com");
            assert.notEqual(res.Contents[2].Owner.ID, undefined);
        });

        mocha.it('list-object-versions should return proper object owner and id', async function() {
            if (is_azure_mock) this.skip();
            this.timeout(120000);
            await s3.copyObject({
                Bucket: bucket_name,
                Key: text_file2,
                CopySource: `/${bucket_name}/${text_file1}`,
            });
            await s3.copyObject({
                Bucket: bucket_name,
                Key: text_file3,
                CopySource: `/${BKT5}/${text_file5}`,
            });
            const res = await s3.listObjectVersions({ Bucket: bucket_name });

            assert.strictEqual(res.Versions[0].Key, text_file1);
            assert.strictEqual(res.Versions[0].Owner.DisplayName, "coretest@noobaa.com");
            assert.notEqual(res.Versions[0].Owner.ID, undefined);

            assert.strictEqual(res.Versions[1].Key, text_file2);
            assert.strictEqual(res.Versions[1].Owner.DisplayName, "coretest@noobaa.com");
            assert.notEqual(res.Versions[1].Owner.ID, undefined);

            assert.strictEqual(res.Versions[2].Key, text_file3);
            assert.strictEqual(res.Versions[2].Owner.DisplayName, "coretest@noobaa.com");
            assert.notEqual(res.Versions[2].Owner.ID, undefined);
        });

        mocha.it('should copy text-file tagging', async function() {
            if (is_azure_mock) this.skip();
            this.timeout(120000);
            const params = {
                Bucket: bucket_name,
                Key: text_file1,
                Tagging: {
                    TagSet: [{
                        Key: 's3ops',
                        Value: 'copy_tagging'
                    }]
                }
            };

            await s3.putObjectTagging(params);
            await s3.copyObject({
                Bucket: bucket_name,
                Key: text_file2,
                CopySource: `/${bucket_name}/${text_file1}`,
            });

            const res = await s3.getObjectTagging({ Bucket: bucket_name, Key: text_file2 });

            assert.strictEqual(res.TagSet.length, params.Tagging.TagSet.length, 'Should be 1');
            assert.strictEqual(res.TagSet[0].Value, params.Tagging.TagSet[0].Value);
            assert.strictEqual(res.TagSet[0].Key, params.Tagging.TagSet[0].Key);
        });

        mocha.it('should copy text-file tagging different platform', async function() {
            if (is_azure_mock) this.skip();
            if (!is_other_platform_bucket_created) this.skip();
            this.timeout(120000);
            const params = {
                Bucket: other_platform_bucket,
                Key: text_file1,
                Tagging: {
                    TagSet: [{
                        Key: 's3ops',
                        Value: 'copy_tagging_different_platform'
                    }]
                }
            };
            await s3.putObjectTagging(params);
            await s3.copyObject({
                Bucket: bucket_name,
                Key: text_file2,
                CopySource: `/${other_platform_bucket}/${text_file1}`,
            });
            const res = await s3.getObjectTagging({ Bucket: bucket_name, Key: text_file2 });
            assert.strictEqual(res.TagSet.length, 1, 'Should be 1');
            assert.strictEqual(res.TagSet[0].Value, params.Tagging.TagSet[0].Value);
            assert.strictEqual(res.TagSet[0].Key, params.Tagging.TagSet[0].Key);
        });

        mocha.it('should copy text-file multi-part', async function() {
            if (is_azure_mock) this.skip();
            this.timeout(600000);
            const res1 = await s3.createMultipartUpload({
                Bucket: bucket_name,
                Key: text_file2
            });

            await s3.uploadPartCopy({
                Bucket: bucket_name,
                Key: text_file2,
                UploadId: res1.UploadId,
                PartNumber: 1,
                CopySource: `/${bucket_name}/${text_file1}`,
            });
            await s3.uploadPartCopy({
                Bucket: bucket_name,
                Key: text_file2,
                UploadId: res1.UploadId,
                PartNumber: 1,
                CopySource: `/${bucket_name}/${text_file1}`,
                CopySourceRange: "bytes=1-5",
            });
            await s3.uploadPartCopy({
                Bucket: bucket_name,
                Key: text_file2,
                UploadId: res1.UploadId,
                PartNumber: 1,
                CopySource: `/${BKT5}/${text_file5}`,
            });
            await s3.uploadPartCopy({
                Bucket: bucket_name,
                Key: text_file2,
                UploadId: res1.UploadId,
                PartNumber: 1,
                CopySource: `/${BKT5}/${text_file5}`,
                CopySourceRange: "bytes=1-5",
            });
            await s3.uploadPartCopy({
                Bucket: bucket_name,
                Key: text_file2,
                UploadId: res1.UploadId,
                PartNumber: 1,
                CopySource: `/${source_bucket}/${text_file5}`,
            });
            const res7 = await s3.uploadPartCopy({
                Bucket: bucket_name,
                Key: text_file2,
                UploadId: res1.UploadId,
                PartNumber: 1,
                CopySource: `/${source_bucket}/${text_file5}`,
                CopySourceRange: "bytes=1-5",
            });
            // list_uploads
            const res6 = await s3.listMultipartUploads({
                Bucket: bucket_name
            });
            const UploadId = _.result(_.find(res6.Uploads, function(obj) {
                return obj.UploadId === res1.UploadId;
            }), 'UploadId');
            if (!is_azure_namespace) assert.strictEqual(UploadId, res1.UploadId);


            // list_multiparts
            const res5 = await s3.listParts({
                Bucket: bucket_name,
                Key: text_file2,
                UploadId: res1.UploadId,
            });
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
            });
        });

        mocha.it('should allow multipart with empty part', async function() {
            this.timeout(600000);

            if (is_azure_namespace) this.skip();
            const res1 = await s3.createMultipartUpload({
                Bucket: bucket_name,
                Key: text_file2
            });

            const res2 = await s3.uploadPart({
                Bucket: bucket_name,
                Body: "blabla",
                Key: text_file2,
                UploadId: res1.UploadId,
                PartNumber: 1,
            });
            const res3 = await s3.uploadPart({
                Bucket: bucket_name,
                Key: text_file2, // No Body - use to fail - BZ2040682
                UploadId: res1.UploadId,
                PartNumber: 2,
            });
            // list_uploads
            const res6 = await s3.listMultipartUploads({
                Bucket: bucket_name
            });
            const UploadId = _.result(_.find(res6.Uploads, function(obj) {
                return obj.UploadId === res1.UploadId;
            }), 'UploadId');
            if (!is_azure_namespace) assert.strictEqual(UploadId, res1.UploadId);

            // list_multiparts
            const res5 = await s3.listParts({
                Bucket: bucket_name,
                Key: text_file2,
                UploadId: res1.UploadId,
            });
            assert.strictEqual(res5.Parts.length, 2);
            assert.strictEqual(res5.Parts[0].ETag, res2.ETag);
            assert.strictEqual(res5.Parts[1].ETag, res3.ETag);

            await s3.completeMultipartUpload({
                Bucket: bucket_name,
                Key: text_file2,
                UploadId: res1.UploadId,
                MultipartUpload: {
                    Parts: [{
                        ETag: res2.ETag,
                        PartNumber: 1
                    }, {
                        ETag: res3.ETag,
                        PartNumber: 2
                    }]
                }
            });
        });

        mocha.it('should list objects with text-file', async function() {
            this.timeout(60000);
            const ORIG_INLINE_MAX_SIZE = config.INLINE_MAX_SIZE;
            // Change the inline max size so the objects get cached.
            if (caching) {
                config.INLINE_MAX_SIZE = 1;
            }

            const res1 = await s3.listObjects({ Bucket: bucket_name });
            // populate cache
            await s3.getObject({ Bucket: bucket_name, Key: text_file1 });
            // text_file2 is not created for azurite since non of the tests creating it are supported (copy / multipart empty upload)
            if (!is_azure_mock) await s3.getObject({ Bucket: bucket_name, Key: text_file2 });
            // text_file3 was created using copy - Azurite does not support it
            if (!is_azure_mock) await s3.getObject({ Bucket: bucket_name, Key: text_file3 });

            assert.strictEqual(res1.Contents[0].Key, text_file1);
            assert.strictEqual(res1.Contents[0].Size, file_body.length);
            assert.strictEqual(res1.Contents.length, is_azure_mock ? 1 : 3);

            if (!caching) return;
            await P.delay(300);

            const params_req = {
                Bucket: bucket_name,
            };
            s3.middlewareStack.add(next => args => {
                args.request.query.get_from_cache = 'true'; // represents query_params = { get_from_cache: true }
                return next(args);
            }, { step: 'build', name: 'getFromCache' });
            const res2 = await s3.listObjects(params_req);
            s3.middlewareStack.remove('getFromCache');

            assert.strictEqual(res2.Contents.length, is_azure_mock ? 1 : 3);
            assert.strictEqual(res2.Contents[0].Key, text_file1);
            // text_file2 is not created for azurite since non of the tests creating it are supported (copy / multipart empty upload)
            if (!is_azure_mock) assert.strictEqual(res2.Contents[1].Key, text_file2);
            // key3 was created using copy - Azurite doesn't support it
            if (!is_azure_mock) assert.strictEqual(res2.Contents[2].Key, text_file3);

            config.INLINE_MAX_SIZE = ORIG_INLINE_MAX_SIZE;
        });

        mocha.it('should delete non existing object without failing', async function() {
            this.timeout(60000);
            const key_to_delete = 'non-existing-obj';
            const res = await s3.deleteObject({ Bucket: bucket_name, Key: key_to_delete });
            const res_without_metadata = _.omit(res, '$metadata');
            assert.deepEqual(res_without_metadata, {});

        });

        mocha.it('should delete multiple non existing objects without failing', async function() {
            this.timeout(60000);
            const keys_to_delete = [
                { Key: 'non-existing-obj1' },
                { Key: 'non-existing-obj2' },
                { Key: 'non-existing-obj3' }
            ];
            const res = await s3.deleteObjects({
                Bucket: bucket_name,
                Delete: {
                    Objects: keys_to_delete
                }
            });
            assert.deepEqual(res.Deleted, keys_to_delete);
            assert.equal(res.Errors, undefined);

        });

        mocha.it('should delete text-file', async function() {
            this.timeout(60000);
            // await s3.deleteObjects({
            //     Bucket: bucket_name,
            //     Delete: {
            //         Objects: [{ Key: text_file1 }, { Key: text_file2 }]
            //     }
            // });
            await s3.deleteObject({ Bucket: BKT5, Key: text_file5 });
            await s3.deleteObject({ Bucket: source_bucket, Key: text_file5 });
            await s3.deleteObject({ Bucket: bucket_name, Key: text_file1 });
            // key is not created for azurite since non of the tests creating it are supported (copy / multipart empty upload)
            if (!is_azure_mock) await s3.deleteObject({ Bucket: bucket_name, Key: text_file2 });
            // text_file3 was created using copy - Azurite does not support it
            if (!is_azure_mock) await s3.deleteObject({ Bucket: bucket_name, Key: text_file3 });
            if (is_other_platform_bucket_created) {
                await s3.deleteObject({ Bucket: other_platform_bucket, Key: text_file1 });
            }
        });
        mocha.it('should list objects after no objects left', async function() {
            this.timeout(100000);
            const res = await s3.listObjects({ Bucket: bucket_name });
            assert.strictEqual(res.Contents, undefined);
        });

        mocha.it('Should create DeleteObjects as the number of the keys (different keys)', async function() {
            this.timeout(100000);
            await s3.putObject({
                Bucket: bucket_name,
                Key: text_file1,
                Body: file_body2,
                ContentType: 'text/plain'
            });
            await s3.putObject({
                Bucket: bucket_name,
                Key: text_file2,
                Body: file_body2,
                ContentType: 'text/plain'
            });
            await s3.putObject({
                Bucket: bucket_name,
                Key: text_file3,
                Body: file_body2,
                ContentType: 'text/plain'
            });
            const delete_res = await s3.deleteObjects({
                Bucket: bucket_name,
                Delete: {
                    Objects: [{ Key: text_file1 }, { Key: text_file2 }, { Key: text_file3 }] // different keys
                }
            });
            assert.equal(delete_res.Deleted.length, 3);
        });

        mocha.it('Should create one DeleteObjects (same key)', async function() {
            this.timeout(100000);
            await s3.putObject({
                Bucket: bucket_name,
                Key: text_file1,
                Body: file_body2,
                ContentType: 'text/plain'
            });
            const delete_res = await s3.deleteObjects({
                Bucket: bucket_name,
                Delete: {
                    Objects: [{ Key: text_file1 }, { Key: text_file1 }, { Key: text_file1 }] // same key
                }
            });
            assert.equal(delete_res.Deleted.length, 1);
        });

        mocha.it('Providing an empty object version ID should return an error', async function() {
            try {
                await s3.getObject({
                    Bucket: bucket_name,
                    Key: text_file1,
                    VersionId: ''
                });
                assert.fail("getObject with empty VersionId passed when it should've failed");
            } catch (err) {
                assert.strictEqual(err.Code, "InvalidArgument");
            }
        });

        mocha.it('Providing an empty object version ID marker should return an error', async function() {
            try {
                await s3.listObjectVersions({
                    Bucket: bucket_name,
                    KeyMarker: text_file1,
                    VersionIdMarker: ''
                });
                assert.fail("listObjectVersions with empty VersionId passed when it should've failed");
            } catch (err) {
                assert.strictEqual(err.Code, "InvalidArgument");
            }
        });

        mocha.it('should copy object (with copy source: /bucket/key)', async function() {
            if (is_azure_mock) this.skip();
            this.timeout(120000);
            const key = 'HappyFace';
            const body = 'hello_world';
            const copied_key = 'HappyFaceCopy';
            // 1. put
            // 2. copy the key (regular)
            // 3. delete objects (so we can delete the bucket in the "after all" hook)
            const res_put = await s3.putObject({
                Bucket: bucket_name,
                Key: key,
                Body: body
            });
            const res_copy = await s3.copyObject({
                Bucket: bucket_name,
                Key: copied_key,
                CopySource: `/${bucket_name}/${key}`,
            });
            await s3.deleteObjects({
                Bucket: bucket_name,
                Delete: {
                    Objects: [{ Key: key }, { Key: copied_key }]
                }
            });
            assert.equal(res_put.$metadata.httpStatusCode, 200);
            assert.equal(res_copy.$metadata.httpStatusCode, 200);
        });

        mocha.it('should copy object (with copy source: %2bucket%2key)', async function() {
            if (is_azure_mock) this.skip();
            this.timeout(120000);
            const key = 'HappyFace2';
            const body = 'hello_world';
            const copied_key = 'HappyFaceCopy2';
            // replace the '/' with %2
            const copy_source_escaped = encodeURIComponent(`/${bucket_name}/${key}`);
            // 1. put
            // 2. copy the key (with encoded slash between the bucket and the key)
            // 3. delete objects (so we can delete the bucket in the "after all" hook)
            const res_put = await s3.putObject({
                Bucket: bucket_name,
                Key: key,
                Body: body
            });
            const res_copy = await s3.copyObject({
                Bucket: bucket_name,
                Key: copied_key,
                CopySource: copy_source_escaped,
            });
            await s3.deleteObjects({
                Bucket: bucket_name,
                Delete: {
                    Objects: [{ Key: key }, { Key: copied_key }]
                }
            });
            assert.equal(res_put.$metadata.httpStatusCode, 200);
            assert.equal(res_copy.$metadata.httpStatusCode, 200);
        });

        mocha.it('should getObjectAttributes', async function() {
            if (is_azure_mock) this.skip();
            this.timeout(120000);
            const key = 'HappyDay';
            const body = 'hello_world';
            await s3.putObject({
                Bucket: bucket_name,
                Key: key,
                Body: body
            });
            const res = await s3.getObjectAttributes({
                Bucket: bucket_name,
                Key: key,
                ObjectAttributes: ['ETag'],
            });
            assert.equal(res.$metadata.httpStatusCode, 200);
            assert.ok(res.ETag !== undefined);
            await s3.deleteObject({
                Bucket: bucket_name,
                Key: key,
            });
        });

        mocha.after(async function() {
            this.timeout(100000);
            if (bucket_type === "regular") {
                await s3.deleteBucket({ Bucket: source_bucket });
                await s3.deleteBucket({ Bucket: bucket_name });
                await s3.deleteBucket({ Bucket: BKT5 });
                if (is_other_platform_bucket_created) {
                    await s3.deleteBucket({ Bucket: other_platform_bucket });
                    await rpc_client.pool.delete_namespace_resource({ name: NAMESPACE_RESOURCE_OTHER_PLATFORM });
                    await rpc_client.account.delete_external_connection({ connection_name: CONNECTION_NAME_OTHER_PLATFORM });
                }
            } else {
                if (!USE_REMOTE_ENDPOINT) {
                    await s3.deleteBucket({ Bucket: source_namespace_bucket });
                    await s3.deleteBucket({ Bucket: target_namespace_bucket });
                }
                await s3.deleteBucket({ Bucket: BKT5 });
                await rpc_client.bucket.delete_bucket({ name: bucket_name });
                await rpc_client.pool.delete_namespace_resource({ name: NAMESPACE_RESOURCE_SOURCE });

                await s3.deleteBucket({ Bucket: source_bucket });
                await rpc_client.pool.delete_namespace_resource({ name: NAMESPACE_RESOURCE_TARGET });
                await rpc_client.account.delete_external_connection({ connection_name: CONNECTION_NAME });
                await s3.deleteBucket({ Bucket: other_platform_bucket });
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

    mocha.describe('azure-namespace-bucket-object-ops', function() {
        const options = {
            endpoint: process.env.NEWAZUREPROJKEY ? 'https://blob.core.windows.net' : azure_mock_endpoint,
            endpoint_type: 'AZURE',
            identity: process.env.NEWAZUREPROJKEY || azure_mock_account,
            secret: process.env.NEWAZUREPROJSECRET || azure_mock_key
        };
        test_object_ops(BKT6, 'namespace', undefined, options);
    });

    mocha.describe('aws-namespace-bucket-object-ops', function() {
        if (!process.env.NEWAWSPROJKEY || !process.env.NEWAWSPROJSECRET) return;
        const options = {
            endpoint: 'https://s3.amazonaws.com',
            endpoint_type: 'AWS',
            identity: process.env.NEWAWSPROJKEY,
            secret: process.env.NEWAWSPROJSECRET
        };
        test_object_ops(BKT7, 'namespace', undefined, options);
    });
});

function is_namespace_blob_bucket(bucket_type, remote_endpoint_type) {
    return remote_endpoint_type === 'AZURE' && bucket_type === 'namespace';
}

// currently azurite does not support StageBlockFromURI - https://github.com/Azure/Azurite/issues/699
// so we would skip copy tests and deletions of objects created by copy
function is_namespace_blob_mock(bucket_type, remote_endpoint_type) {
    return remote_endpoint_type === 'AZURE' && bucket_type === 'namespace' && !process.env.NEWAZUREPROJKEY;
}
