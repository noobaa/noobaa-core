/* Copyright (C) 2025 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');
const { S3 } = require('@aws-sdk/client-s3');
const http = require('http');
const crypto = require('crypto');
const { NodeHttpHandler } = require("@smithy/node-http-handler");

const { get_coretest_path } = require('../system_tests/test_utils');
const coretest_path = get_coretest_path();
const coretest = require(coretest_path);
const { S3Error } = require('../../endpoint/s3/s3_errors');
const config = require('../../../config');
const { rpc_client, EMAIL } = coretest; //, PASSWORD, SYSTEM

coretest.setup({ pools_to_create: process.env.NC_CORETEST ? undefined : [coretest.POOL_LIST[1]] });

function generate_public_policy(bucket) {
    return JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Sid: 'id-1',
            Effect: "Allow",
            Principal: { AWS: "*" },
            Action: ["s3:*"],
            Resource: [
                `arn:aws:s3:::${bucket}/*`,
                `arn:aws:s3:::${bucket}`,
            ],
        }]
    });
}

/**
 * 
 * @param {S3} s3 
 * @param {string} bucket_prefix 
 * @param {*} cb 
 */
async function run_on_random_bucket(s3, bucket_prefix, cb) {
    const bucket = `${bucket_prefix}-${crypto.randomUUID()}`;
    await s3.createBucket({ Bucket: bucket });

    try {
        await cb(bucket);
    } finally {
        await s3.deleteBucket({ Bucket: bucket }).catch(() => { /* nothing */ });
    }
}

mocha.describe('noobaa public access block test', function() {
    this.timeout(60000); // eslint-disable-line no-invalid-this
    const bucket_prefix = 'pab-bucket';

    const s3_creds = {
        forcePathStyle: true,
        region: config.DEFAULT_REGION,
        requestHandler: new NodeHttpHandler({
            httpAgent: new http.Agent({ keepAlive: false })
        }),
    };
    /**@type {S3} */
    let s3_owner;

    /**@type {S3} */
    let s3_anon;

    mocha.before(async function() {
        if (process.env.NC_CORETEST) {
            try {
                await rpc_client.account.read_account({ email: config.ANONYMOUS_ACCOUNT_NAME + '@' });
            } catch (err) {
                const error = JSON.parse(err.stdout);
                if (error.error.code === 'NoSuchAccountName') {
                    await rpc_client.account.create_account({
                        name: config.ANONYMOUS_ACCOUNT_NAME,
                        nsfs_account_config: {
                            uid: 0,
                            gid: 0
                        }
                    });
                }
            }
        }

        const admin_account = await rpc_client.account.read_account({ email: EMAIL });
        const admin_keys = admin_account.access_keys;

        s3_creds.credentials = {
            accessKeyId: admin_keys[0].access_key.unwrap(),
            secretAccessKey: admin_keys[0].secret_key.unwrap(),
        };
        s3_creds.endpoint = coretest.get_http_address();

        s3_owner = new S3(s3_creds);
        s3_anon = new S3({
            ...s3_creds,
            credentials: {
                accessKeyId: undefined,
                secretAccessKey: undefined,
            },
            // workaround for makeUnauthenticatedRequest that doesn't exist in AWS SDK V3
            // taken form here: https://github.com/aws/aws-sdk-js-v3/issues/2321#issuecomment-916336230
            // It is a custom signer that returns the request as is (not modifying the request)
            signer: { sign: async request => request },
        });
    });

    mocha.it('put_public_access_block must throw when acls are used', async function() {
        await run_on_random_bucket(s3_owner, bucket_prefix, async bucket => {
            await assert.rejects(
                s3_owner.putPublicAccessBlock({
                    Bucket: bucket,
                    PublicAccessBlockConfiguration: {
                        BlockPublicAcls: true,
                    }
                }),
                error => {
                    // @ts-ignore
                    assert(error.Code === S3Error.AccessControlListNotSupported.code);
                    return true;
                }
            );

            await assert.rejects(
                s3_owner.putPublicAccessBlock({
                    Bucket: bucket,
                    PublicAccessBlockConfiguration: {
                        IgnorePublicAcls: true,
                    }
                }),
                error => {
                    // @ts-ignore
                    assert(error.Code === S3Error.AccessControlListNotSupported.code);
                    return true;
                }
            );
        });
    });

    mocha.it('public_access_block should work when block public policy is used', async function() {
        await run_on_random_bucket(s3_owner, bucket_prefix, async bucket => {
            await s3_owner.putPublicAccessBlock({
                Bucket: bucket,
                PublicAccessBlockConfiguration: {
                    BlockPublicPolicy: true,
                }
            });

            // Ensure we cannot put a public policy on this bucket
            await assert.rejects(
                s3_owner.putBucketPolicy({
                    Bucket: bucket,
                    Policy: generate_public_policy(bucket),
                })
            );

            await s3_owner.deletePublicAccessBlock({
                Bucket: bucket,
            });
        });
    });

    mocha.it('public_access_block should work when restrict public buckets is used', async function() {
        await run_on_random_bucket(s3_owner, bucket_prefix, async function(bucket) {
            const KEY = "key";

            await s3_owner.putObject({
                Bucket: bucket,
                Key: KEY,
                Body: crypto.randomBytes(1024),
            });

            // Ensure we can put a public policy on this bucket
            await s3_owner.putBucketPolicy({
                Bucket: bucket,
                Policy: generate_public_policy(bucket),
            });

            // Ensure anon can access
            await s3_anon.getObject({
                Bucket: bucket,
                Key: KEY,
            });

            await s3_owner.putPublicAccessBlock({
                Bucket: bucket,
                PublicAccessBlockConfiguration: {
                    RestrictPublicBuckets: true,
                }
            });

            // Ensure anon can no longer access
            await assert.rejects(
                s3_anon.getObject({
                    Bucket: bucket,
                    Key: KEY,
                }),
            );

            await s3_owner.deletePublicAccessBlock({
                Bucket: bucket,
            });

            await s3_owner.deleteObject({
                Bucket: bucket,
                Key: KEY,
            });
        });
    });
});

