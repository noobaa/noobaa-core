/* Copyright (C) 2025 NooBaa */
/* eslint-disable no-invalid-this */
/* eslint max-lines-per-function: ["error", 500]*/

'use strict';
// setup coretest first to prepare the env
const { require_coretest, is_nc_coretest, TMP_PATH } = require('../../../system_tests/test_utils');
const coretest = require_coretest();
let setup_options;
if (is_nc_coretest) {
    setup_options = { should_run_vectors: true, debug: 5 };
} else {
    setup_options = { pools_to_create: [coretest.POOL_LIST[1]] };
}
coretest.setup(setup_options);
const config = require('../../../../../config');
const { S3 } = require('@aws-sdk/client-s3');
const s3vectors = require('@aws-sdk/client-s3vectors');
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const mocha = require('mocha');
const assert = require('assert');
const fs = require('fs').promises;
const https = require('https');
const path = require('path');
const { rpc_client, EMAIL, get_current_setup_options, stop_nsfs_process, start_nsfs_process } = coretest;
const http_utils = require('../../../../util/http_utils');

const VECTOR_BUCKET = 'test-vec-policy-buc';
/** Distinct from test_vectors_ops (same fs_root_path is rejected as IN_USE / "Target already in use"). */
const LANCE_ROOT = path.join(TMP_PATH, 'lance-vector-policy');
const nsr = 'nsr-vector-policy';

mocha.describe('vector_bucket_policy', function() {

    /** @type {S3} */
    let s3_client;
    let s3_vectors_client;

    mocha.before(async function() {
        const self = this;
        self.timeout(60000);

        if (is_nc_coretest) {
            const current = get_current_setup_options();
            if (!current.should_run_vectors) {
                await stop_nsfs_process();
                await start_nsfs_process(setup_options);
            }
            await fs.mkdir(LANCE_ROOT, { recursive: true });
        }

        const account_info = await rpc_client.account.read_account({ email: EMAIL });
        const access_key = account_info.access_keys[0].access_key.unwrap();
        const secret_key = account_info.access_keys[0].secret_key.unwrap();

        const client_params = {
            endpoint: coretest.get_https_address_vectors(),
            credentials: {
                accessKeyId: access_key,
                secretAccessKey: secret_key,
            },
            region: config.DEFAULT_REGION,
            requestHandler: new NodeHttpHandler({
                httpsAgent: new https.Agent({ rejectUnauthorized: false })
            }),
        };
        s3_vectors_client = new s3vectors.S3VectorsClient(client_params);

        await rpc_client.pool.create_namespace_resource({
            name: nsr,
            nsfs_config: {
                fs_root_path: LANCE_ROOT,
            }
        });

        s3_vectors_client.middlewareStack.add(
            (next, context) => async args => {
                const request = /** @type {{ headers?: Record<string, string> }} */ (args.request);
                if (request.headers) {
                    request.headers[config.VECTORS_NSR_HEADER] = nsr;
                }
                return await next(args);
            },
            {
                step: 'build',
                name: 'noobaa_vector_headers',
                priority: 'high',
            }
        );

        const http_address = is_nc_coretest ? coretest.get_https_address() : coretest.get_http_address();
        const s3_client_params = {
            endpoint: http_address,
            credentials: {
                accessKeyId: access_key,
                secretAccessKey: secret_key,
            },
            forcePathStyle: true,
            region: config.DEFAULT_REGION,
            requestHandler: new NodeHttpHandler(is_nc_coretest ? {
                httpsAgent: new https.Agent({ rejectUnauthorized: false }),
            } : {
                httpAgent: http_utils.get_unsecured_agent(http_address),
            }),
        };
        s3_client = new S3(s3_client_params);
    });

    mocha.beforeEach(async function() {
        await s3_client.createBucket({ Bucket: 'lance' });
        await create_vector_bucket(s3_vectors_client, VECTOR_BUCKET);
    });

    mocha.afterEach(async function() {
        try {
            await s3_vectors_client.send(new s3vectors.DeleteVectorBucketPolicyCommand({
                vectorBucketName: VECTOR_BUCKET,
            }));
        } catch (err) {
            // ignore - policy may not exist or may already be deleted
        }
        await send(s3_vectors_client, new s3vectors.DeleteVectorBucketCommand({
            vectorBucketName: VECTOR_BUCKET
        }));
        await s3_client.deleteBucket({ Bucket: 'lance' });
    });

    ////////////////////////////////
    // CRUD TESTS                 //
    ////////////////////////////////

    mocha.describe('vector bucket policy CRUD', function() {

        mocha.it('should put a vector bucket policy', async function() {
            const policy = make_allow_all_policy(VECTOR_BUCKET);
            await put_policy(s3_vectors_client, VECTOR_BUCKET, policy);
        });

        mocha.it('should get a vector bucket policy', async function() {
            const policy = make_policy(VECTOR_BUCKET, [{
                Effect: 'Allow',
                Principal: '*',
                Action: 's3vectors:GetVectorBucket',
                Resource: `arn:aws:s3vectors:::${VECTOR_BUCKET}`,
            }]);
            await put_policy(s3_vectors_client, VECTOR_BUCKET, policy);

            const response = await send(s3_vectors_client, new s3vectors.GetVectorBucketPolicyCommand({
                vectorBucketName: VECTOR_BUCKET,
            }));
            const returned_policy = JSON.parse(response.policy);
            assert.deepStrictEqual(returned_policy, policy);
        });

        mocha.it('should delete a vector bucket policy', async function() {
            await put_policy(s3_vectors_client, VECTOR_BUCKET, make_allow_all_policy(VECTOR_BUCKET));
            await send(s3_vectors_client, new s3vectors.DeleteVectorBucketPolicyCommand({
                vectorBucketName: VECTOR_BUCKET,
            }));

            try {
                await s3_vectors_client.send(new s3vectors.GetVectorBucketPolicyCommand({
                    vectorBucketName: VECTOR_BUCKET,
                }));
                assert.fail('Expected error for missing policy');
            } catch (err) {
                assert.strictEqual(err.name, 'NoSuchVectorBucketPolicy');
            }
        });

        mocha.it('should reject policy on non-existent vector bucket', async function() {
            const non_existent = 'non-existent-vector-bucket';
            const policy = make_allow_all_policy(non_existent);
            try {
                await s3_vectors_client.send(new s3vectors.PutVectorBucketPolicyCommand({
                    vectorBucketName: non_existent,
                    policy: JSON.stringify(policy),
                }));
                assert.fail('Expected error for non-existent vector bucket');
            } catch (err) {
                assert.strictEqual(err.name, 'NotFoundException');
            }
        });
    });

    ////////////////////////////////
    // VALIDATION TESTS           //
    ////////////////////////////////

    mocha.describe('vector bucket policy validation', function() {

        mocha.it('should reject a malformed vector bucket policy (invalid S3 action)', async function() {
            const malformed_policy = make_policy(VECTOR_BUCKET, [{
                Effect: 'Allow',
                Principal: '*',
                Action: 's3:GetObject',
                Resource: `arn:aws:s3:::${VECTOR_BUCKET}`,
            }]);
            try {
                await s3_vectors_client.send(new s3vectors.PutVectorBucketPolicyCommand({
                    vectorBucketName: VECTOR_BUCKET,
                    policy: JSON.stringify(malformed_policy),
                }));
                assert.fail('Expected error for malformed policy');
            } catch (err) {
                assert.strictEqual(err.name, 'ValidationException');
                assert.ok(err.message, 'Expected validation error message');
            }
        });

        mocha.it('should reject policy with invalid action', async function() {
            const policy = make_policy(VECTOR_BUCKET, [{
                Effect: 'Allow',
                Principal: '*',
                Action: 's3vectors:NoSuchAction',
                Resource: `arn:aws:s3vectors:::${VECTOR_BUCKET}`,
            }]);
            try {
                await s3_vectors_client.send(new s3vectors.PutVectorBucketPolicyCommand({
                    vectorBucketName: VECTOR_BUCKET,
                    policy: JSON.stringify(policy),
                }));
                assert.fail('Expected error for invalid action');
            } catch (err) {
                assert.strictEqual(err.name, 'ValidationException');
                assert.ok(err.message);
            }
        });

        mocha.it('should reject policy with invalid resource', async function() {
            const policy = make_policy(VECTOR_BUCKET, [{
                Effect: 'Allow',
                Principal: '*',
                Action: 's3vectors:*',
                Resource: `arn:aws:s3vectors:::some-other-bucket`,
            }]);
            try {
                await s3_vectors_client.send(new s3vectors.PutVectorBucketPolicyCommand({
                    vectorBucketName: VECTOR_BUCKET,
                    policy: JSON.stringify(policy),
                }));
                assert.fail('Expected error for invalid resource');
            } catch (err) {
                assert.strictEqual(err.name, 'ValidationException');
                assert.ok(err.message);
            }
        });
    });

    ////////////////////////////////
    // AUTHORIZATION TESTS        //
    ////////////////////////////////

    mocha.describe('vector bucket policy authorization', function() {

        mocha.it('should allow operations without a policy (default allow)', async function() {
            try {
                await s3_vectors_client.send(new s3vectors.GetVectorBucketPolicyCommand({
                    vectorBucketName: VECTOR_BUCKET,
                }));
                assert.fail('Expected error for missing policy');
            } catch (err) {
                assert.strictEqual(err.name, 'NoSuchVectorBucketPolicy');
            }
        });

        mocha.it('should allow operation when policy has explicit allow with wildcard action', async function() {
            await put_policy(s3_vectors_client, VECTOR_BUCKET, make_allow_all_policy(VECTOR_BUCKET));

            const response = await send(s3_vectors_client, new s3vectors.GetVectorBucketPolicyCommand({
                vectorBucketName: VECTOR_BUCKET,
            }));
            assert.ok(response.policy);
        });

        mocha.it('should allow operation when policy allows specific action', async function() {
            const policy = make_policy(VECTOR_BUCKET, [{
                Effect: 'Allow',
                Principal: '*',
                Action: 's3vectors:GetVectorBucketPolicy',
                Resource: `arn:aws:s3vectors:::${VECTOR_BUCKET}`,
            }]);
            await put_policy(s3_vectors_client, VECTOR_BUCKET, policy);

            const response = await send(s3_vectors_client, new s3vectors.GetVectorBucketPolicyCommand({
                vectorBucketName: VECTOR_BUCKET,
            }));
            const returned_policy = JSON.parse(response.policy);
            assert.deepStrictEqual(returned_policy, policy);
        });

        mocha.it('should deny operation when policy has explicit deny', async function() {
            const deny_policy = make_policy(VECTOR_BUCKET, [{
                Effect: 'Deny',
                Principal: '*',
                Action: 's3vectors:GetVectorBucketPolicy',
                Resource: `arn:aws:s3vectors:::${VECTOR_BUCKET}`,
            }]);
            await put_policy(s3_vectors_client, VECTOR_BUCKET, deny_policy);

            try {
                await s3_vectors_client.send(new s3vectors.GetVectorBucketPolicyCommand({
                    vectorBucketName: VECTOR_BUCKET,
                }));
                assert.fail('Expected AccessDeniedException');
            } catch (err) {
                assert.strictEqual(err.name, 'AccessDeniedException');
            }
        });

        mocha.it('should deny one action but allow another with mixed policy (deny overrides allow)', async function() {
            const mixed_policy = make_policy(VECTOR_BUCKET, [
                {
                    Effect: 'Allow',
                    Principal: '*',
                    Action: 's3vectors:*',
                    Resource: `arn:aws:s3vectors:::${VECTOR_BUCKET}`,
                },
                {
                    Effect: 'Deny',
                    Principal: '*',
                    Action: 's3vectors:DeleteVectorBucketPolicy',
                    Resource: `arn:aws:s3vectors:::${VECTOR_BUCKET}`,
                }
            ]);
            await put_policy(s3_vectors_client, VECTOR_BUCKET, mixed_policy);

            const response = await send(s3_vectors_client, new s3vectors.GetVectorBucketPolicyCommand({
                vectorBucketName: VECTOR_BUCKET,
            }));
            assert.ok(response.policy);

            try {
                await s3_vectors_client.send(new s3vectors.DeleteVectorBucketPolicyCommand({
                    vectorBucketName: VECTOR_BUCKET,
                }));
                assert.fail('Expected AccessDeniedException for denied delete');
            } catch (err) {
                assert.strictEqual(err.name, 'AccessDeniedException');
            }

            await put_policy(s3_vectors_client, VECTOR_BUCKET, make_allow_all_policy(VECTOR_BUCKET));
        });

        mocha.it('should deny specific action with deny and allow specific action - deny wins', async function() {
            const policy = make_policy(VECTOR_BUCKET, [
                {
                    Effect: 'Allow',
                    Principal: '*',
                    Action: 's3vectors:GetVectorBucketPolicy',
                    Resource: `arn:aws:s3vectors:::${VECTOR_BUCKET}`,
                },
                {
                    Effect: 'Deny',
                    Principal: '*',
                    Action: 's3vectors:GetVectorBucketPolicy',
                    Resource: `arn:aws:s3vectors:::${VECTOR_BUCKET}`,
                }
            ]);
            await put_policy(s3_vectors_client, VECTOR_BUCKET, policy);

            try {
                await s3_vectors_client.send(new s3vectors.GetVectorBucketPolicyCommand({
                    vectorBucketName: VECTOR_BUCKET,
                }));
                assert.fail('Expected AccessDeniedException - deny should override allow');
            } catch (err) {
                assert.strictEqual(err.name, 'AccessDeniedException');
            }

            await put_policy(s3_vectors_client, VECTOR_BUCKET, make_allow_all_policy(VECTOR_BUCKET));
        });

        mocha.it('should allow with NotAction (allow all except specified action)', async function() {
            const policy = make_policy(VECTOR_BUCKET, [{
                Effect: 'Allow',
                Principal: '*',
                NotAction: 's3vectors:DeleteVectorBucketPolicy',
                Resource: `arn:aws:s3vectors:::${VECTOR_BUCKET}`,
            }]);
            await put_policy(s3_vectors_client, VECTOR_BUCKET, policy);

            const response = await send(s3_vectors_client, new s3vectors.GetVectorBucketPolicyCommand({
                vectorBucketName: VECTOR_BUCKET,
            }));
            assert.ok(response.policy);
        });

        mocha.it('should deny with NotAction (deny all except specified action)', async function() {
            const policy = make_policy(VECTOR_BUCKET, [
                {
                    Effect: 'Allow',
                    Principal: '*',
                    Action: 's3vectors:*',
                    Resource: `arn:aws:s3vectors:::${VECTOR_BUCKET}`,
                },
                {
                    Effect: 'Deny',
                    Principal: '*',
                    NotAction: ['s3vectors:GetVectorBucketPolicy', 's3vectors:PutVectorBucketPolicy'],
                    Resource: `arn:aws:s3vectors:::${VECTOR_BUCKET}`,
                }
            ]);
            await put_policy(s3_vectors_client, VECTOR_BUCKET, policy);

            const response = await send(s3_vectors_client, new s3vectors.GetVectorBucketPolicyCommand({
                vectorBucketName: VECTOR_BUCKET,
            }));
            assert.ok(response.policy);

            try {
                await s3_vectors_client.send(new s3vectors.DeleteVectorBucketPolicyCommand({
                    vectorBucketName: VECTOR_BUCKET,
                }));
                assert.fail('Expected AccessDeniedException for denied delete');
            } catch (err) {
                assert.strictEqual(err.name, 'AccessDeniedException');
            }

            await put_policy(s3_vectors_client, VECTOR_BUCKET, make_allow_all_policy(VECTOR_BUCKET));
        });

        mocha.it('should deny delete but allow put with per-action statements', async function() {
            const policy = make_policy(VECTOR_BUCKET, [
                {
                    Effect: 'Allow',
                    Principal: '*',
                    Action: ['s3vectors:PutVectorBucketPolicy', 's3vectors:GetVectorBucketPolicy'],
                    Resource: `arn:aws:s3vectors:::${VECTOR_BUCKET}`,
                },
                {
                    Effect: 'Deny',
                    Principal: '*',
                    Action: 's3vectors:DeleteVectorBucketPolicy',
                    Resource: `arn:aws:s3vectors:::${VECTOR_BUCKET}`,
                }
            ]);
            await put_policy(s3_vectors_client, VECTOR_BUCKET, policy);

            const get_response = await send(s3_vectors_client, new s3vectors.GetVectorBucketPolicyCommand({
                vectorBucketName: VECTOR_BUCKET,
            }));
            assert.ok(get_response.policy);

            try {
                await s3_vectors_client.send(new s3vectors.DeleteVectorBucketPolicyCommand({
                    vectorBucketName: VECTOR_BUCKET,
                }));
                assert.fail('Expected AccessDeniedException');
            } catch (err) {
                assert.strictEqual(err.name, 'AccessDeniedException');
            }

            await put_policy(s3_vectors_client, VECTOR_BUCKET, make_allow_all_policy(VECTOR_BUCKET));
        });

        mocha.it('should enforce policy after update (replace allow with deny)', async function() {
            const allow_policy = make_allow_all_policy(VECTOR_BUCKET);
            await put_policy(s3_vectors_client, VECTOR_BUCKET, allow_policy);

            const response = await send(s3_vectors_client, new s3vectors.GetVectorBucketPolicyCommand({
                vectorBucketName: VECTOR_BUCKET,
            }));
            assert.ok(response.policy);

            const deny_policy = make_policy(VECTOR_BUCKET, [{
                Effect: 'Deny',
                Principal: '*',
                Action: 's3vectors:GetVectorBucketPolicy',
                Resource: `arn:aws:s3vectors:::${VECTOR_BUCKET}`,
            }]);
            await put_policy(s3_vectors_client, VECTOR_BUCKET, deny_policy);

            try {
                await s3_vectors_client.send(new s3vectors.GetVectorBucketPolicyCommand({
                    vectorBucketName: VECTOR_BUCKET,
                }));
                assert.fail('Expected AccessDeniedException after policy update');
            } catch (err) {
                assert.strictEqual(err.name, 'AccessDeniedException');
            }

            await put_policy(s3_vectors_client, VECTOR_BUCKET, make_allow_all_policy(VECTOR_BUCKET));
        });

        mocha.it('should allow after deleting a deny policy', async function() {
            const deny_policy = make_policy(VECTOR_BUCKET, [{
                Effect: 'Deny',
                Principal: '*',
                Action: 's3vectors:GetVectorBucketPolicy',
                Resource: `arn:aws:s3vectors:::${VECTOR_BUCKET}`,
            }]);
            await put_policy(s3_vectors_client, VECTOR_BUCKET, deny_policy);

            try {
                await s3_vectors_client.send(new s3vectors.GetVectorBucketPolicyCommand({
                    vectorBucketName: VECTOR_BUCKET,
                }));
                assert.fail('Expected AccessDeniedException');
            } catch (err) {
                assert.strictEqual(err.name, 'AccessDeniedException');
            }

            await send(s3_vectors_client, new s3vectors.DeleteVectorBucketPolicyCommand({
                vectorBucketName: VECTOR_BUCKET,
            }));

            try {
                await s3_vectors_client.send(new s3vectors.GetVectorBucketPolicyCommand({
                    vectorBucketName: VECTOR_BUCKET,
                }));
                assert.fail('Expected NoSuchVectorBucketPolicy after delete');
            } catch (err) {
                assert.strictEqual(err.name, 'NoSuchVectorBucketPolicy');
            }
        });
    });
});

//////////////////////////
// HELPERS              //
//////////////////////////

function make_policy(bucket_name, statements) {
    return {
        Version: '2012-10-17',
        Statement: statements,
    };
}

function make_allow_all_policy(bucket_name) {
    return make_policy(bucket_name, [{
        Effect: 'Allow',
        Principal: '*',
        Action: 's3vectors:*',
        Resource: `arn:aws:s3vectors:::${bucket_name}`,
    }]);
}

async function create_vector_bucket(client, name) {
    const command = new s3vectors.CreateVectorBucketCommand({ vectorBucketName: name });
    await send(client, command);
}

async function put_policy(client, bucket_name, policy) {
    const command = new s3vectors.PutVectorBucketPolicyCommand({
        vectorBucketName: bucket_name,
        policy: JSON.stringify(policy),
    });
    await send(client, command);
}

async function send(client, command) {
    const response = await client.send(command);
    assert.strictEqual(response.$metadata.httpStatusCode, 200);
    assert.strictEqual(response.$metadata.attempts, 1);
    assert(response.$metadata.requestId);
    assert(response.$metadata.extendedRequestId);
    return response;
}
