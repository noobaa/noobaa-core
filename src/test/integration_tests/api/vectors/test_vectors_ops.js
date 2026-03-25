/* Copyright (C) 2025 NooBaa */
/* eslint-disable no-invalid-this */

'use strict';
// setup coretest first to prepare the env
const { require_coretest, is_nc_coretest } = require('../../../system_tests/test_utils');
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
const https = require('https');
const { rpc_client, EMAIL, get_current_setup_options, stop_nsfs_process, start_nsfs_process } = coretest;
const http_utils = require('../../../../util/http_utils');

mocha.describe('vectors_ops', function() {

    /** @type {S3} */
    let s3_client;
    let s3_client_params;
    let s3_vectors_client;
    /** @type {import("@aws-sdk/client-s3vectors").S3VectorsClientConfig} */
    let client_params;

    mocha.before(async function() {
        const self = this;
        self.timeout(60000);

        if (is_nc_coretest) {
            const current = get_current_setup_options();
            if (!current.should_run_vectors) {
                await stop_nsfs_process();
                await start_nsfs_process(setup_options);
            }
        }

        const account_info = await rpc_client.account.read_account({ email: EMAIL });
        const access_key = account_info.access_keys[0].access_key.unwrap();
        const secret_key = account_info.access_keys[0].secret_key.unwrap();

        client_params = {
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

        console.log("client_params: ", client_params);
        console.log("coretest.get_http_address() =", coretest.get_http_address());
        s3_vectors_client = new s3vectors.S3VectorsClient(client_params);
        coretest.log('VECTORS S3 CONFIG', s3_vectors_client.config);

        const http_address = is_nc_coretest ? coretest.get_https_address() : coretest.get_http_address();
        s3_client_params = {
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

    mocha.describe('vector-bucket-ops', function() {

        const vector_bucket_name1 = 'test-vec-buc1';

        mocha.beforeEach(async function() {
            await s3_client.createBucket({ Bucket: 'lance' });
        });

        mocha.afterEach(async function() {

            const del_vec_buck = new s3vectors.DeleteVectorBucketCommand({
                vectorBucketName: vector_bucket_name1
            });
            await send(s3_vectors_client, del_vec_buck);

            await s3_client.deleteBucket({ Bucket: 'lance' });
        });

        mocha.it('should create a vector bucket', async function() {
            await create_vector_bucket(s3_vectors_client, vector_bucket_name1);
        });

        mocha.it('should list vector buckets', async function() {
            const beforeTs = Date.now();
            await create_vector_bucket(s3_vectors_client, vector_bucket_name1);
            const afterTs = Date.now();

            const command = new s3vectors.ListVectorBucketsCommand({});
            const response = await send(s3_vectors_client, command);

            assert.strictEqual(response.vectorBuckets[0].vectorBucketName, vector_bucket_name1);
            const ts = response.vectorBuckets[0].creationTime.getTime();
            assert(ts > beforeTs);
            assert(afterTs > ts);
        });


        mocha.it('should delete a vector bucket', async function() {
            await create_vector_bucket(s3_vectors_client, vector_bucket_name1);

            const list_commnad = new s3vectors.ListVectorBucketsCommand({});
            let response = await send(s3_vectors_client, list_commnad);
            assert.strictEqual(response.vectorBuckets[0].vectorBucketName, vector_bucket_name1);

            const delete_commnad = new s3vectors.DeleteVectorBucketCommand({
                vectorBucketName: vector_bucket_name1
            });
            await send(s3_vectors_client, delete_commnad);

            response = await send(s3_vectors_client, list_commnad);
            assert.strictEqual(response.vectorBuckets.length, 0);

            //to simplfy cleanup just recreate the bucket
            await create_vector_bucket(s3_vectors_client, vector_bucket_name1);
        });

        mocha.it('should list vectors (on md)', async function() {
            await create_vector_bucket(s3_vectors_client, vector_bucket_name1);

            const vectors = [
                {
                    key: "vector_id_1",
                    data: {float32: [0.1, 0.2, 0.3]},
                    //metadata: JSON.stringify({ "source_file": "doc1.txt", "chunk_id": "1" }), 
                },
                {
                    key: "vector_id_2",
                    data: {float32: [0.4, 0.5, 0.6]},
                    //metadata: JSON.stringify({ "source_file": "doc1.txt", "chunk_id": "2" }),
                }
            ];

            const put_commnad = new s3vectors.PutVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                vectors
            });
            await send(s3_vectors_client, put_commnad);

            const list_commnad = new s3vectors.ListVectorsCommand({
                vectorBucketName: vector_bucket_name1
            });
            const response = await send(s3_vectors_client, list_commnad);

            compare_vectors(response.vectors, vectors, true);
        });

        mocha.it('should query vectors (no md, no filter)', async function() {
            await create_vector_bucket(s3_vectors_client, vector_bucket_name1);

            const vectors = [
                {
                    key: "vector_id_1",
                    data: {float32: [0.1, 0.2, 0.3]},
                },
                {
                    key: "vector_id_2",
                    data: {float32: [0.4, 0.5, 0.6]},
                }
            ];

            const put_commnad = new s3vectors.PutVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                vectors
            });
            await send(s3_vectors_client, put_commnad);

            const query_commnad = new s3vectors.QueryVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                queryVector: {float32: [0.2, 0.4, 0.6]},
                topK: 10
            });
            const response = await send(s3_vectors_client, query_commnad);

            compare_vectors(response.vectors, vectors, false);
            //TODO - verify distance? metric?
        });

        mocha.it('should delete vectors', async function() {
            await create_vector_bucket(s3_vectors_client, vector_bucket_name1);

            const vectors = [
                {
                    key: "vector_id_1",
                    data: {float32: [0.1, 0.2, 0.3]},
                },
                {
                    key: "vector_id_2",
                    data: {float32: [0.4, 0.5, 0.6]},
                }
            ];

            const put_commnad = new s3vectors.PutVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                vectors
            });
            await send(s3_vectors_client, put_commnad);

            const list_commnad = new s3vectors.ListVectorsCommand({
                vectorBucketName: vector_bucket_name1
            });
            let response = await send(s3_vectors_client, list_commnad);

            compare_vectors(response.vectors, vectors, false);

            const delete_command = new s3vectors.DeleteVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                keys: ["vector_id_2"]
            });
            await send(s3_vectors_client, delete_command);

            response = await send(s3_vectors_client, list_commnad);

            vectors.pop();
            compare_vectors(response.vectors, vectors, false);
        });

        mocha.it('should put a vector bucket policy', async function() {
            await create_vector_bucket(s3_vectors_client, vector_bucket_name1);

            const policy = {
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Principal: '*',
                    Action: 's3vectors:*',
                    Resource: `arn:aws:s3vectors:::${vector_bucket_name1}`,
                }]
            };

            const put_cmd = new s3vectors.PutVectorBucketPolicyCommand({
                vectorBucketName: vector_bucket_name1,
                policy: JSON.stringify(policy),
            });
            await send(s3_vectors_client, put_cmd);
        });

        mocha.it('should get a vector bucket policy', async function() {
            await create_vector_bucket(s3_vectors_client, vector_bucket_name1);

            const policy = {
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Principal: '*',
                    Action: 's3vectors:GetVectorBucket',
                    Resource: `arn:aws:s3vectors:::${vector_bucket_name1}`,
                }]
            };

            const put_cmd = new s3vectors.PutVectorBucketPolicyCommand({
                vectorBucketName: vector_bucket_name1,
                policy: JSON.stringify(policy),
            });
            await send(s3_vectors_client, put_cmd);

            const get_cmd = new s3vectors.GetVectorBucketPolicyCommand({
                vectorBucketName: vector_bucket_name1,
            });
            const response = await send(s3_vectors_client, get_cmd);
            const returned_policy = JSON.parse(response.policy);
            assert.deepStrictEqual(returned_policy, policy);
        });

        mocha.it('should reject a malformed vector bucket policy', async function() {
            await create_vector_bucket(s3_vectors_client, vector_bucket_name1);

            const malformed_policy = {
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Principal: '*',
                    Action: 's3:GetObject',
                    Resource: `arn:aws:s3:::${vector_bucket_name1}`,
                }]
            };

            const put_cmd = new s3vectors.PutVectorBucketPolicyCommand({
                vectorBucketName: vector_bucket_name1,
                policy: JSON.stringify(malformed_policy),
            });
            try {
                await s3_vectors_client.send(put_cmd);
                assert.fail('Expected error for malformed policy');
            } catch (err) {
                console.error('Received expected error for malformed policy:', err);
                assert.strictEqual(err.name, 'ValidationException');
                assert.ok(err.fieldList, 'Expected fieldList in validation error');
                assert.ok(err.fieldList.length > 0, 'Expected at least one entry in fieldList');
                assert.strictEqual(err.fieldList[0].path, 'policy');
            }
        });

        mocha.it('should reject policy on non-existent vector bucket', async function() {
            await create_vector_bucket(s3_vectors_client, vector_bucket_name1);
            const non_existent_bucket = 'non-existent-vector-bucket';
            const policy = {
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Principal: '*',
                    Action: 's3vectors:*',
                    Resource: `arn:aws:s3vectors:::${non_existent_bucket}`,
                }]
            };

            const put_cmd = new s3vectors.PutVectorBucketPolicyCommand({
                vectorBucketName: non_existent_bucket,
                policy: JSON.stringify(policy),
            });
            try {
                await s3_vectors_client.send(put_cmd);
                assert.fail('Expected error for non-existent vector bucket');
            } catch (err) {
                assert.strictEqual(err.name, 'NotFoundException');
            }
        });

        mocha.it('should delete a vector bucket policy', async function() {
            await create_vector_bucket(s3_vectors_client, vector_bucket_name1);

            const policy = {
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Principal: '*',
                    Action: 's3vectors:*',
                    Resource: `arn:aws:s3vectors:::${vector_bucket_name1}`,
                }]
            };

            const put_cmd = new s3vectors.PutVectorBucketPolicyCommand({
                vectorBucketName: vector_bucket_name1,
                policy: JSON.stringify(policy),
            });
            await send(s3_vectors_client, put_cmd);

            const del_cmd = new s3vectors.DeleteVectorBucketPolicyCommand({
                vectorBucketName: vector_bucket_name1,
            });
            await send(s3_vectors_client, del_cmd);

            const get_cmd = new s3vectors.GetVectorBucketPolicyCommand({
                vectorBucketName: vector_bucket_name1,
            });
            try {
                await s3_vectors_client.send(get_cmd);
                assert.fail('Expected error for missing policy');
            } catch (err) {
                assert.strictEqual(err.name, 'NoSuchVectorBucketPolicy');
            }
        });

    });
});

async function create_vector_bucket(client, name) {
            const params = {
                vectorBucketName: name
            };
            const command = new s3vectors.CreateVectorBucketCommand(params);
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

function compare_vectors(actual, expected, expect_data) {
    assert.strictEqual(actual.length, expected.length);

    const expected_map = new Map(expected.map(x => [x.key, expect_data ? x.data.float32 : x]));

    for (let i = 0; i < actual.length; ++i) {
        const actual_vector = actual[i];
        const expected_data = expected_map.get(actual_vector.key);
        assert(expected_data);
        if (expect_data) {
            const actual_data = actual_vector.data.float32;
            assert.strictEqual(actual_data.length, expected_data.length);
            for (let j = 0; j < actual_data.length; ++j) {
                assert(Math.abs(actual_data[j] - expected_data[j]) < 0.00001);
            }
        }
    }
}
