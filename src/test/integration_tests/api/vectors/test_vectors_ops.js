/* Copyright (C) 2025 NooBaa */
/* eslint-disable no-invalid-this */
/* eslint-disable max-lines-per-function */

'use strict';
// Use require_coretest() so NC runs (nc_index) load nc_coretest; container runs load coretest.js.
const { require_coretest, is_nc_coretest, TMP_PATH } = require('../../../system_tests/test_utils');
const fs = require('fs').promises;
const coretest = require_coretest();
let setup_options;
if (is_nc_coretest) {
    setup_options = { should_run_vectors: true, should_run_iam: true, debug: 5 };
} else {
    setup_options = { pools_to_create: [coretest.POOL_LIST[1]] };
}
coretest.setup(setup_options);
const config = require('../../../../../config');
const s3vectors = require('@aws-sdk/client-s3vectors');
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const mocha = require('mocha');
const assert = require('assert');
const https = require('https');
const path = require('path');
const { rpc_client, EMAIL } = coretest;

mocha.describe('vectors_ops', function() {

    /** @type {s3vectors.S3VectorsClient} */
    let s3_vectors_client;
    /** @type {s3vectors.S3VectorsClientConfig} */
    let client_params;
    let created_vector_indices;
    let created_vector_buckets;
    const nsr = 'nsr';

    mocha.before(async function() {
        const self = this;
        self.timeout(is_nc_coretest ? 120000 : 60000);
        if (is_nc_coretest) {
            const current = coretest.get_current_setup_options();
            if (!current.should_run_vectors) {
                await coretest.stop_nsfs_process();
                await coretest.start_nsfs_process(setup_options);
            }
            await fs.mkdir(path.join(TMP_PATH, 'lance'), { recursive: true });
        }
        const account_info = await rpc_client.account.read_account({ email: EMAIL });
        client_params = {
            endpoint: coretest.get_https_address_vectors(),
            credentials: {
                accessKeyId: account_info.access_keys[0].access_key.unwrap(),
                secretAccessKey: account_info.access_keys[0].secret_key.unwrap(),
            },
            region: config.DEFAULT_REGION,
            requestHandler: new NodeHttpHandler({
                httpsAgent: new https.Agent({ rejectUnauthorized: false }) // disable SSL certificate validation
            }),
        };

        console.log("client_params: ", client_params);
        console.log("coretest.get_http_address() =", coretest.get_http_address());
        s3_vectors_client = new s3vectors.S3VectorsClient(client_params);
        coretest.log('VECTORS S3 CONFIG', s3_vectors_client.config);

        await rpc_client.pool.create_namespace_resource({
            name: nsr,
            nsfs_config: {
                fs_root_path: path.join(TMP_PATH, 'lance'),
            }
        });

        //add custom ns for s3
        s3_vectors_client.middlewareStack.add(
            (next, context) => async args => {
                const request = args.request;
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
    });

    mocha.describe('vector-bucket-ops', function() {

        const vector_bucket_name1 = 'test-vec-buc1';
        const vector_index_name1 = 'test-vec-ind1';

        mocha.beforeEach(async function() {
            created_vector_indices = [];
            created_vector_buckets = [];
        });

        mocha.afterEach(async function() {

            for (const vector_index of created_vector_indices) {
                const del_vec_index = new s3vectors.DeleteIndexCommand({
                    vectorBucketName: vector_index.vector_bucket,
                    indexName: vector_index.vector_index,
                });
                await send(s3_vectors_client, del_vec_index);
            }

            for (const vector_bucket of created_vector_buckets) {
                const del_vec_buck = new s3vectors.DeleteVectorBucketCommand({
                    vectorBucketName: vector_bucket
                });
                await send(s3_vectors_client, del_vec_buck);
            }
        });

        mocha.it('should create a vector bucket', async function() {
            await create_vector_bucket(s3_vectors_client, created_vector_buckets, vector_bucket_name1);
        });

        mocha.it('should create a vector bucket (non-filterable)', async function() {
            await create_vector_bucket(s3_vectors_client, created_vector_buckets, vector_bucket_name1, {
                metadataConfiguration: {
                    nonFilterableMetadataKeys: [ "field_name" ]
                }
            });
        });

        mocha.it('should get a vector bucket', async function() {
            const beforeTs = Date.now();
            await create_vector_bucket(s3_vectors_client, created_vector_buckets, vector_bucket_name1);
            const afterTs = Date.now();

            const get_command = new s3vectors.GetVectorBucketCommand({
                vectorBucketName: vector_bucket_name1,
            });
            const response = await send(s3_vectors_client, get_command);

            validate_vector_bucket(response.vectorBucket, vector_bucket_name1, beforeTs, afterTs);
        });

        mocha.it('should list vector buckets', async function() {
            const beforeTs = Date.now();
            await create_vector_bucket(s3_vectors_client, created_vector_buckets, vector_bucket_name1);
            const afterTs = Date.now();

            const command = new s3vectors.ListVectorBucketsCommand({});
            const response = await send(s3_vectors_client, command);

            validate_vector_bucket(response.vectorBuckets[0], vector_bucket_name1, beforeTs, afterTs);
        });

        mocha.it('should delete a vector bucket', async function() {
            await create_vector_bucket(s3_vectors_client, created_vector_buckets, vector_bucket_name1);

            const list_command = new s3vectors.ListVectorBucketsCommand({});
            let response = await send(s3_vectors_client, list_command);
            assert.strictEqual(response.vectorBuckets[0].vectorBucketName, vector_bucket_name1);

            const delete_command = new s3vectors.DeleteVectorBucketCommand({
                vectorBucketName: vector_bucket_name1
            });
            await send(s3_vectors_client, delete_command);

            response = await send(s3_vectors_client, list_command);
            assert.strictEqual(response.vectorBuckets.length, 0);

            //manually fixup vector buckets tracking array
            created_vector_buckets = [];
        });

        mocha.it('should create a vector index', async function() {
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);
        });

        mocha.it('should get a vector index', async function() {
            const beforeTs = Date.now();
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);
            const afterTs = Date.now();

            const put_command = new s3vectors.GetIndexCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
            });
            const response = await send(s3_vectors_client, put_command);

            validate_vector_index(response.index, vector_bucket_name1, vector_index_name1, beforeTs, afterTs);
        });

        mocha.it('should delete a vector index', async function() {
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);

            const list_command = new s3vectors.ListIndexesCommand({
                vectorBucketName: vector_bucket_name1,
            });
            let response = await send(s3_vectors_client, list_command);
            assert.strictEqual(response.indexes[0].vectorBucketName, vector_bucket_name1);
            assert.strictEqual(response.indexes[0].indexName, vector_index_name1);

            const delete_command = new s3vectors.DeleteIndexCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1
            });
            await send(s3_vectors_client, delete_command);

            response = await send(s3_vectors_client, list_command);
            assert.strictEqual(response.indexes.length, 0);

            //manually fixup vector indices tracking
            created_vector_indices = [];
        });

        mocha.it('should list vectors (no md)', async function() {
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);

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

            const put_command = new s3vectors.PutVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                vectors
            });
            await send(s3_vectors_client, put_command);

            const list_command = new s3vectors.ListVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
            });
            const response = await send(s3_vectors_client, list_command);

            compare_vectors(response.vectors, vectors, true);
        });

        mocha.it('should list vectors (next_token, max_results)', async function() {
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);

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
                indexName: vector_index_name1,
                vectors
            });
            await send(s3_vectors_client, put_commnad);

            const list_commnad = new s3vectors.ListVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                maxResults: 1,
            });
            let response = await send(s3_vectors_client, list_commnad);

            compare_vectors(response.vectors, [vectors[0]], true);
            assert.strictEqual(response.nextToken, "1_2");

            list_commnad.input.nextToken = response.nextToken;
            response = await send(s3_vectors_client, list_commnad);
            compare_vectors(response.vectors, [vectors[1]], true);
            assert(!response.nextToken);
        });

        mocha.it('should list vectors (segment)', async function() {
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);

            const vectors = [];

            for (let i = 0; i < 10; ++i) {
                vectors.push({
                    key: "vector_id_" + i,
                    data: {float32: [0.1, 0.2, 0.3]},
                });
            }

            const put_commnad = new s3vectors.PutVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                vectors
            });
            await send(s3_vectors_client, put_commnad);

            const list_commnad = new s3vectors.ListVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                segmentCount: 3,
                segmentIndex: 0
            });
            let response = await send(s3_vectors_client, list_commnad);
            compare_vectors(response.vectors, [vectors[0], vectors[1], vectors[2]], true);
            assert(!response.nextToken);

            list_commnad.input.segmentIndex = 1;
            response = await send(s3_vectors_client, list_commnad);
            compare_vectors(response.vectors, [vectors[3], vectors[4], vectors[5]], true);
            assert(!response.nextToken);

            list_commnad.input.segmentIndex = 2;
            response = await send(s3_vectors_client, list_commnad);
            compare_vectors(response.vectors, [vectors[6], vectors[7], vectors[8], vectors[9]], true);
            assert(!response.nextToken);
        });

        mocha.it('should list vectors (segment, max_results)', async function() {
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);

            const vectors = [];

            for (let i = 0; i < 11; ++i) {
                vectors.push({
                    key: "vector_id_" + i,
                    data: {float32: [0.1, 0.2, 0.3]},
                });
            }

            const put_commnad = new s3vectors.PutVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                vectors
            });
            await send(s3_vectors_client, put_commnad);

            const list_commnad = new s3vectors.ListVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                segmentCount: 3,
                segmentIndex: 0,
                maxResults: 2,
            });

            let response = await send(s3_vectors_client, list_commnad);
            compare_vectors(response.vectors, [vectors[0], vectors[1]], true);
            assert.strictEqual(response.nextToken, "2_3");
            list_commnad.input.nextToken = response.nextToken;
            response = await send(s3_vectors_client, list_commnad);
            compare_vectors(response.vectors, [vectors[2]], true);
            assert(!response.nextToken);

            list_commnad.input.segmentIndex = 1;
            delete list_commnad.input.nextToken;
            response = await send(s3_vectors_client, list_commnad);
            compare_vectors(response.vectors, [vectors[3], vectors[4]], true);
            assert.strictEqual(response.nextToken, "5_6");
            list_commnad.input.nextToken = response.nextToken;
            response = await send(s3_vectors_client, list_commnad);
            compare_vectors(response.vectors, [vectors[5]], true);
            assert(!response.nextToken);

            list_commnad.input.segmentIndex = 2;
            delete list_commnad.input.nextToken;
            response = await send(s3_vectors_client, list_commnad);
            compare_vectors(response.vectors, [vectors[6], vectors[7]], true);
            assert.strictEqual(response.nextToken, "8_11");
            list_commnad.input.nextToken = response.nextToken;
            response = await send(s3_vectors_client, list_commnad);
            compare_vectors(response.vectors, [vectors[8], vectors[9]], true);
            assert.strictEqual(response.nextToken, "10_11");
            list_commnad.input.nextToken = response.nextToken;
            response = await send(s3_vectors_client, list_commnad);
            compare_vectors(response.vectors, [vectors[10]], true);
            assert(!response.nextToken);
        });


        mocha.it('should query vectors (no md, no filter)', async function() {
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);

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

            const put_command = new s3vectors.PutVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                vectors
            });
            await send(s3_vectors_client, put_command);

            const query_command = new s3vectors.QueryVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                queryVector: {float32: [0.2, 0.4, 0.6]},
                topK: 10
            });
            const response = await send(s3_vectors_client, query_command);

            compare_vectors(response.vectors, vectors, false);
            //TODO - verify distance? metric?
        });

        mocha.it('should query vectors (filter: $eq)', async function() {
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);

            const vectors = [
                {
                    key: "vector_id_1",
                    data: {float32: [0.1, 0.2, 0.3]},
                    metadata: {age: 20}
                },
                {
                    key: "vector_id_2",
                    data: {float32: [0.2, 0.3, 0.4]},
                    metadata: {age: 25}
                },
                {
                    key: "vector_id_3",
                    data: {float32: [0.3, 0.4, 0.5]},
                    metadata: {age: 30}
                },
                {
                    key: "vector_id_4",
                    data: {float32: [0.4, 0.5, 0.6]},
                    metadata: {age: 35}
                }
            ];

            const put_command = new s3vectors.PutVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                vectors
            });
            await send(s3_vectors_client, put_command);

            const query_command = new s3vectors.QueryVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                queryVector: {float32: [0.2, 0.3, 0.4]},
                topK: 10,
                filter: {age: {$eq: 25}}
            });
            const response = await send(s3_vectors_client, query_command);

            // Should return only vectors with age = 25
            assert.strictEqual(response.vectors.length, 1);
            assert.strictEqual(response.vectors[0].key, 'vector_id_2');
        });

        mocha.it('should query vectors (filter: $ne)', async function() {
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);

            const vectors = [
                {
                    key: "vector_id_1",
                    data: {float32: [0.1, 0.2, 0.3]},
                    metadata: {age: 20}
                },
                {
                    key: "vector_id_2",
                    data: {float32: [0.2, 0.3, 0.4]},
                    metadata: {age: 25}
                },
                {
                    key: "vector_id_3",
                    data: {float32: [0.3, 0.4, 0.5]},
                    metadata: {age: 30}
                },
                {
                    key: "vector_id_4",
                    data: {float32: [0.4, 0.5, 0.6]},
                    metadata: {age: 35}
                }
            ];

            const put_command = new s3vectors.PutVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                vectors
            });
            await send(s3_vectors_client, put_command);

            const query_command = new s3vectors.QueryVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                queryVector: {float32: [0.2, 0.3, 0.4]},
                topK: 10,
                filter: {age: {$ne: 25}}
            });
            const response = await send(s3_vectors_client, query_command);

            // Should return vectors with age != 25 (vec1, vec3, vec4)
            assert.strictEqual(response.vectors.length, 3);
            const returned_keys = response.vectors.map(v => v.key).sort();
            assert.deepStrictEqual(returned_keys, ['vector_id_1', 'vector_id_3', 'vector_id_4']);
        });

        mocha.it('should query vectors (filter: $gt)', async function() {
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);

            const vectors = [
                {
                    key: "vector_id_1",
                    data: {float32: [0.1, 0.2, 0.3]},
                    metadata: {age: 20}
                },
                {
                    key: "vector_id_2",
                    data: {float32: [0.2, 0.3, 0.4]},
                    metadata: {age: 25}
                },
                {
                    key: "vector_id_3",
                    data: {float32: [0.3, 0.4, 0.5]},
                    metadata: {age: 30}
                },
                {
                    key: "vector_id_4",
                    data: {float32: [0.4, 0.5, 0.6]},
                    metadata: {age: 35}
                }
            ];

            const put_command = new s3vectors.PutVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                vectors
            });
            await send(s3_vectors_client, put_command);

            const query_command = new s3vectors.QueryVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                queryVector: {float32: [0.2, 0.3, 0.4]},
                topK: 10,
                filter: {age: {$gt: 25}}
            });
            const response = await send(s3_vectors_client, query_command);

            // Should return only vectors with age > 25 (vec3 and vec4)
            assert.strictEqual(response.vectors.length, 2);
            const returned_keys = response.vectors.map(v => v.key).sort();
            assert.deepStrictEqual(returned_keys, ['vector_id_3', 'vector_id_4']);
        });

        mocha.it('should query vectors (filter: $gte)', async function() {
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);

            const vectors = [
                {
                    key: "vector_id_1",
                    data: {float32: [0.1, 0.2, 0.3]},
                    metadata: {age: 20}
                },
                {
                    key: "vector_id_2",
                    data: {float32: [0.2, 0.3, 0.4]},
                    metadata: {age: 25}
                },
                {
                    key: "vector_id_3",
                    data: {float32: [0.3, 0.4, 0.5]},
                    metadata: {age: 30}
                },
                {
                    key: "vector_id_4",
                    data: {float32: [0.4, 0.5, 0.6]},
                    metadata: {age: 35}
                }
            ];

            const put_command = new s3vectors.PutVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                vectors
            });
            await send(s3_vectors_client, put_command);

            const query_command = new s3vectors.QueryVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                queryVector: {float32: [0.2, 0.3, 0.4]},
                topK: 10,
                filter: {age: {$gte: 25}}
            });
            const response = await send(s3_vectors_client, query_command);

            // Should return vectors with age >= 25 (vec2, vec3, vec4)
            assert.strictEqual(response.vectors.length, 3);
            const returned_keys = response.vectors.map(v => v.key).sort();
            assert.deepStrictEqual(returned_keys, ['vector_id_2', 'vector_id_3', 'vector_id_4']);
        });

        mocha.it('should query vectors (filter: $lt)', async function() {
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);

            const vectors = [
                {
                    key: "vector_id_1",
                    data: {float32: [0.1, 0.2, 0.3]},
                    metadata: {age: 20}
                },
                {
                    key: "vector_id_2",
                    data: {float32: [0.2, 0.3, 0.4]},
                    metadata: {age: 25}
                },
                {
                    key: "vector_id_3",
                    data: {float32: [0.3, 0.4, 0.5]},
                    metadata: {age: 30}
                },
                {
                    key: "vector_id_4",
                    data: {float32: [0.4, 0.5, 0.6]},
                    metadata: {age: 35}
                }
            ];

            const put_command = new s3vectors.PutVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                vectors
            });
            await send(s3_vectors_client, put_command);

            const query_command = new s3vectors.QueryVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                queryVector: {float32: [0.2, 0.3, 0.4]},
                topK: 10,
                filter: {age: {$lt: 30}}
            });
            const response = await send(s3_vectors_client, query_command);

            // Should return vectors with age < 30 (vec1 and vec2)
            assert.strictEqual(response.vectors.length, 2);
            const returned_keys = response.vectors.map(v => v.key).sort();
            assert.deepStrictEqual(returned_keys, ['vector_id_1', 'vector_id_2']);
        });

        mocha.it('should query vectors (filter: $lte)', async function() {
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);

            const vectors = [
                {
                    key: "vector_id_1",
                    data: {float32: [0.1, 0.2, 0.3]},
                    metadata: {age: 20}
                },
                {
                    key: "vector_id_2",
                    data: {float32: [0.2, 0.3, 0.4]},
                    metadata: {age: 25}
                },
                {
                    key: "vector_id_3",
                    data: {float32: [0.3, 0.4, 0.5]},
                    metadata: {age: 30}
                },
                {
                    key: "vector_id_4",
                    data: {float32: [0.4, 0.5, 0.6]},
                    metadata: {age: 35}
                }
            ];

            const put_command = new s3vectors.PutVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                vectors
            });
            await send(s3_vectors_client, put_command);

            const query_command = new s3vectors.QueryVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                queryVector: {float32: [0.2, 0.3, 0.4]},
                topK: 10,
                filter: {age: {$lte: 30}}
            });
            const response = await send(s3_vectors_client, query_command);

            // Should return vectors with age <= 30 (vec1, vec2, vec3)
            assert.strictEqual(response.vectors.length, 3);
            const returned_keys = response.vectors.map(v => v.key).sort();
            assert.deepStrictEqual(returned_keys, ['vector_id_1', 'vector_id_2', 'vector_id_3']);
        });

        mocha.it('should query vectors (filter: simple equality)', async function() {
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);

            const vectors = [
                {
                    key: "vector_id_1",
                    data: {float32: [0.1, 0.2, 0.3]},
                    metadata: {age: 20}
                },
                {
                    key: "vector_id_2",
                    data: {float32: [0.2, 0.3, 0.4]},
                    metadata: {age: 25}
                },
                {
                    key: "vector_id_3",
                    data: {float32: [0.3, 0.4, 0.5]},
                    metadata: {age: 30}
                },
                {
                    key: "vector_id_4",
                    data: {float32: [0.4, 0.5, 0.6]},
                    metadata: {age: 35}
                }
            ];

            const put_command = new s3vectors.PutVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                vectors
            });
            await send(s3_vectors_client, put_command);

            const query_command = new s3vectors.QueryVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                queryVector: {float32: [0.2, 0.3, 0.4]},
                topK: 10,
                filter: {age: 30}
            });
            const response = await send(s3_vectors_client, query_command);

            // Should return only vectors with age = 30 (implicit equality)
            assert.strictEqual(response.vectors.length, 1);
            assert.strictEqual(response.vectors[0].key, 'vector_id_3');
        });

        mocha.it('should query vectors (filter: string metadata)', async function() {
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);

            const vectors = [
                {
                    key: "vector_id_1",
                    data: {float32: [0.1, 0.2, 0.3]},
                    metadata: {category: 'basic'}
                },
                {
                    key: "vector_id_2",
                    data: {float32: [0.2, 0.3, 0.4]},
                    metadata: {category: 'standard'}
                },
                {
                    key: "vector_id_3",
                    data: {float32: [0.3, 0.4, 0.5]},
                    metadata: {category: 'premium'}
                },
                {
                    key: "vector_id_4",
                    data: {float32: [0.4, 0.5, 0.6]},
                    metadata: {category: 'premium'}
                }
            ];

            const put_command = new s3vectors.PutVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                vectors
            });
            await send(s3_vectors_client, put_command);

            const query_command = new s3vectors.QueryVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                queryVector: {float32: [0.2, 0.3, 0.4]},
                topK: 10,
                filter: {category: 'premium'}
            });
            const response = await send(s3_vectors_client, query_command);

            // Should return only vectors with category = 'premium'
            assert.strictEqual(response.vectors.length, 2);
            const returned_keys = response.vectors.map(v => v.key).sort();
            assert.deepStrictEqual(returned_keys, ['vector_id_3', 'vector_id_4']);
        });

        mocha.it('should query vectors (filter: $in)', async function() {
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);

            const vectors = [
                {
                    key: "vector_id_1",
                    data: {float32: [0.1, 0.2, 0.3]},
                    metadata: {age: 20}
                },
                {
                    key: "vector_id_2",
                    data: {float32: [0.2, 0.3, 0.4]},
                    metadata: {age: 25}
                },
                {
                    key: "vector_id_3",
                    data: {float32: [0.3, 0.4, 0.5]},
                    metadata: {age: 30}
                },
                {
                    key: "vector_id_4",
                    data: {float32: [0.4, 0.5, 0.6]},
                    metadata: {age: 35}
                }
            ];

            const put_command = new s3vectors.PutVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                vectors
            });
            await send(s3_vectors_client, put_command);

            const query_command = new s3vectors.QueryVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                queryVector: {float32: [0.2, 0.3, 0.4]},
                topK: 10,
                filter: {age: {$in: [20, 30, 40]}}
            });
            const response = await send(s3_vectors_client, query_command);

            // Should return vectors with age in [20, 30, 40] (vec1 and vec3)
            assert.strictEqual(response.vectors.length, 2);
            const returned_keys = response.vectors.map(v => v.key).sort();
            assert.deepStrictEqual(returned_keys, ['vector_id_1', 'vector_id_3']);
        });

        mocha.it('should query vectors (filter: $nin)', async function() {
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);

            const vectors = [
                {
                    key: "vector_id_1",
                    data: {float32: [0.1, 0.2, 0.3]},
                    metadata: {age: 20}
                },
                {
                    key: "vector_id_2",
                    data: {float32: [0.2, 0.3, 0.4]},
                    metadata: {age: 25}
                },
                {
                    key: "vector_id_3",
                    data: {float32: [0.3, 0.4, 0.5]},
                    metadata: {age: 30}
                },
                {
                    key: "vector_id_4",
                    data: {float32: [0.4, 0.5, 0.6]},
                    metadata: {age: 35}
                }
            ];

            const put_command = new s3vectors.PutVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                vectors
            });
            await send(s3_vectors_client, put_command);

            const query_command = new s3vectors.QueryVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                queryVector: {float32: [0.2, 0.3, 0.4]},
                topK: 10,
                filter: {age: {$nin: [20, 30, 40]}}
            });
            const response = await send(s3_vectors_client, query_command);

            // Should return vectors with age not in [20, 30, 40] (vec2 and vec4)
            assert.strictEqual(response.vectors.length, 2);
            const returned_keys = response.vectors.map(v => v.key).sort();
            assert.deepStrictEqual(returned_keys, ['vector_id_2', 'vector_id_4']);
        });

        mocha.it('should query vectors (filter: $exists)', async function() {
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);

            const vectors = [
                {
                    key: "vector_id_1",
                    data: {float32: [0.1, 0.2, 0.3]},
                    metadata: {age: 20, category: 'basic'}
                },
                {
                    key: "vector_id_2",
                    data: {float32: [0.2, 0.3, 0.4]},
                    metadata: {age: 25}
                },
                {
                    key: "vector_id_3",
                    data: {float32: [0.3, 0.4, 0.5]},
                    metadata: {category: 'premium'}
                },
                {
                    key: "vector_id_4",
                    data: {float32: [0.4, 0.5, 0.6]},
                    metadata: {age: 35, category: 'standard'}
                }
            ];

            const put_command = new s3vectors.PutVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                vectors
            });
            await send(s3_vectors_client, put_command);

            const query_command = new s3vectors.QueryVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                queryVector: {float32: [0.2, 0.3, 0.4]},
                topK: 10,
                filter: {category: {$exists: true}}
            });
            const response = await send(s3_vectors_client, query_command);

            // Should return vectors where category field exists (vec1, vec3, vec4)
            assert.strictEqual(response.vectors.length, 3);
            const returned_keys = response.vectors.map(v => v.key).sort();
            assert.deepStrictEqual(returned_keys, ['vector_id_1', 'vector_id_3', 'vector_id_4']);
        });

        mocha.it('should query vectors (filter: $exists false)', async function() {
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);

            const vectors = [
                {
                    key: "vector_id_1",
                    data: {float32: [0.1, 0.2, 0.3]},
                    metadata: {age: 20, category: 'basic'}
                },
                {
                    key: "vector_id_2",
                    data: {float32: [0.2, 0.3, 0.4]},
                    metadata: {age: 25}
                },
                {
                    key: "vector_id_3",
                    data: {float32: [0.3, 0.4, 0.5]},
                    metadata: {category: 'premium'}
                },
                {
                    key: "vector_id_4",
                    data: {float32: [0.4, 0.5, 0.6]},
                    metadata: {age: 35, category: 'standard'}
                }
            ];

            const put_command = new s3vectors.PutVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                vectors
            });
            await send(s3_vectors_client, put_command);

            const query_command = new s3vectors.QueryVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                queryVector: {float32: [0.2, 0.3, 0.4]},
                topK: 10,
                filter: {category: {$exists: false}}
            });
            const response = await send(s3_vectors_client, query_command);

            // Should return vectors where category field does NOT exist (vec2)
            assert.strictEqual(response.vectors.length, 1);
            assert.strictEqual(response.vectors[0].key, 'vector_id_2');
        });

        mocha.it('should query vectors (filter: $and)', async function() {
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);

            const vectors = [
                {
                    key: "vector_id_1",
                    data: {float32: [0.1, 0.2, 0.3]},
                    metadata: {age: 20, category: 'basic'}
                },
                {
                    key: "vector_id_2",
                    data: {float32: [0.2, 0.3, 0.4]},
                    metadata: {age: 25, category: 'premium'}
                },
                {
                    key: "vector_id_3",
                    data: {float32: [0.3, 0.4, 0.5]},
                    metadata: {age: 30, category: 'premium'}
                },
                {
                    key: "vector_id_4",
                    data: {float32: [0.4, 0.5, 0.6]},
                    metadata: {age: 35, category: 'basic'}
                }
            ];

            const put_command = new s3vectors.PutVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                vectors
            });
            await send(s3_vectors_client, put_command);

            const query_command = new s3vectors.QueryVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                queryVector: {float32: [0.2, 0.3, 0.4]},
                topK: 10,
                filter: {$and: [{age: {$gte: 25}}, {category: 'premium'}]}
            });
            const response = await send(s3_vectors_client, query_command);

            // Should return vectors with age >= 25 AND category = 'premium' (vec2 and vec3)
            assert.strictEqual(response.vectors.length, 2);
            const returned_keys = response.vectors.map(v => v.key).sort();
            assert.deepStrictEqual(returned_keys, ['vector_id_2', 'vector_id_3']);
        });

        mocha.it('should query vectors (filter: $or)', async function() {
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);

            const vectors = [
                {
                    key: "vector_id_1",
                    data: {float32: [0.1, 0.2, 0.3]},
                    metadata: {age: 20, category: 'basic'}
                },
                {
                    key: "vector_id_2",
                    data: {float32: [0.2, 0.3, 0.4]},
                    metadata: {age: 25, category: 'standard'}
                },
                {
                    key: "vector_id_3",
                    data: {float32: [0.3, 0.4, 0.5]},
                    metadata: {age: 30, category: 'premium'}
                },
                {
                    key: "vector_id_4",
                    data: {float32: [0.4, 0.5, 0.6]},
                    metadata: {age: 35, category: 'basic'}
                }
            ];

            const put_command = new s3vectors.PutVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                vectors
            });
            await send(s3_vectors_client, put_command);

            const query_command = new s3vectors.QueryVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                queryVector: {float32: [0.2, 0.3, 0.4]},
                topK: 10,
                filter: {$or: [{age: {$lt: 25}}, {category: 'premium'}]}
            });
            const response = await send(s3_vectors_client, query_command);

            // Should return vectors with age < 25 OR category = 'premium' (vec1 and vec3)
            assert.strictEqual(response.vectors.length, 2);
            const returned_keys = response.vectors.map(v => v.key).sort();
            assert.deepStrictEqual(returned_keys, ['vector_id_1', 'vector_id_3']);
        });

        mocha.it('should query vectors (filter: nested operators - range)', async function() {
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);

            const vectors = [
                {
                    key: "vector_id_1",
                    data: {float32: [0.1, 0.2, 0.3]},
                    metadata: {age: 18}
                },
                {
                    key: "vector_id_2",
                    data: {float32: [0.2, 0.3, 0.4]},
                    metadata: {age: 25}
                },
                {
                    key: "vector_id_3",
                    data: {float32: [0.3, 0.4, 0.5]},
                    metadata: {age: 35}
                },
                {
                    key: "vector_id_4",
                    data: {float32: [0.4, 0.5, 0.6]},
                    metadata: {age: 45}
                }
            ];

            const put_command = new s3vectors.PutVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                vectors
            });
            await send(s3_vectors_client, put_command);

            const query_command = new s3vectors.QueryVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                queryVector: {float32: [0.2, 0.3, 0.4]},
                topK: 10,
                filter: {age: {$gte: 20, $lte: 40}}
            });
            const response = await send(s3_vectors_client, query_command);

            // Should return vectors with 20 <= age <= 40 (vec2 and vec3)
            assert.strictEqual(response.vectors.length, 2);
            const returned_keys = response.vectors.map(v => v.key).sort();
            assert.deepStrictEqual(returned_keys, ['vector_id_2', 'vector_id_3']);
        });

        mocha.it('should query vectors (filter: complex $and with multiple fields)', async function() {
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);

            const vectors = [
                {
                    key: "vector_id_1",
                    data: {float32: [0.1, 0.2, 0.3]},
                    metadata: {age: 25, category: 'basic', status: 'active'}
                },
                {
                    key: "vector_id_2",
                    data: {float32: [0.2, 0.3, 0.4]},
                    metadata: {age: 30, category: 'premium', status: 'active'}
                },
                {
                    key: "vector_id_3",
                    data: {float32: [0.3, 0.4, 0.5]},
                    metadata: {age: 35, category: 'premium', status: 'inactive'}
                },
                {
                    key: "vector_id_4",
                    data: {float32: [0.4, 0.5, 0.6]},
                    metadata: {age: 40, category: 'basic', status: 'active'}
                }
            ];

            const put_command = new s3vectors.PutVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                vectors
            });
            await send(s3_vectors_client, put_command);

            const query_command = new s3vectors.QueryVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                queryVector: {float32: [0.2, 0.3, 0.4]},
                topK: 10,
                filter: {$and: [{age: {$gte: 25}}, {category: 'premium'}, {status: 'active'}]}
            });
            const response = await send(s3_vectors_client, query_command);

            // Should return vectors with age >= 25 AND category = 'premium' AND status = 'active' (only vec2)
            assert.strictEqual(response.vectors.length, 1);
            assert.strictEqual(response.vectors[0].key, 'vector_id_2');
        });

        mocha.it('should query vectors (filter: nested $or with $and)', async function() {
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);

            const vectors = [
                {
                    key: "vector_id_1",
                    data: {float32: [0.1, 0.2, 0.3]},
                    metadata: {age: 20, category: 'basic', vip: false}
                },
                {
                    key: "vector_id_2",
                    data: {float32: [0.2, 0.3, 0.4]},
                    metadata: {age: 25, category: 'standard', vip: true}
                },
                {
                    key: "vector_id_3",
                    data: {float32: [0.3, 0.4, 0.5]},
                    metadata: {age: 30, category: 'premium', vip: false}
                },
                {
                    key: "vector_id_4",
                    data: {float32: [0.4, 0.5, 0.6]},
                    metadata: {age: 35, category: 'basic', vip: false}
                }
            ];

            const put_command = new s3vectors.PutVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                vectors
            });
            await send(s3_vectors_client, put_command);

            const query_command = new s3vectors.QueryVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                queryVector: {float32: [0.2, 0.3, 0.4]},
                topK: 10,
                filter: {
                    $or: [
                        {$and: [{age: {$gte: 30}}, {category: 'premium'}]},
                        {vip: true}
                    ]
                }
            });
            const response = await send(s3_vectors_client, query_command);

            // Should return vectors where (age >= 30 AND category = 'premium') OR vip = true (vec2 and vec3)
            assert.strictEqual(response.vectors.length, 2);
            const returned_keys = response.vectors.map(v => v.key).sort();
            assert.deepStrictEqual(returned_keys, ['vector_id_2', 'vector_id_3']);
        });

        mocha.it('should query vectors (filter: string with special characters)', async function() {
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);

            const vectors = [
                {
                    key: "vector_id_1",
                    data: {float32: [0.1, 0.2, 0.3]},
                    metadata: {name: "John's Document"}
                },
                {
                    key: "vector_id_2",
                    data: {float32: [0.2, 0.3, 0.4]},
                    metadata: {name: "Mary's Report"}
                },
                {
                    key: "vector_id_3",
                    data: {float32: [0.3, 0.4, 0.5]},
                    metadata: {name: "Bob's File"}
                },
                {
                    key: "vector_id_4",
                    data: {float32: [0.4, 0.5, 0.6]},
                    metadata: {name: "Alice Document"}
                }
            ];

            const put_command = new s3vectors.PutVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                vectors
            });
            await send(s3_vectors_client, put_command);

            const query_command = new s3vectors.QueryVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                queryVector: {float32: [0.2, 0.3, 0.4]},
                topK: 10,
                filter: {name: "John's Document"}
            });
            const response = await send(s3_vectors_client, query_command);

            // Should return vector with name containing apostrophe
            assert.strictEqual(response.vectors.length, 1);
            assert.strictEqual(response.vectors[0].key, 'vector_id_1');
        });

        mocha.it('should delete vectors', async function() {
            await create_vector_index(s3_vectors_client, created_vector_buckets,
                created_vector_indices, vector_bucket_name1, vector_index_name1);

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

            const put_command = new s3vectors.PutVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                vectors
            });
            await send(s3_vectors_client, put_command);

            const list_command = new s3vectors.ListVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
            });
            let response = await send(s3_vectors_client, list_command);

            compare_vectors(response.vectors, vectors, false);

            const delete_command = new s3vectors.DeleteVectorsCommand({
                vectorBucketName: vector_bucket_name1,
                indexName: vector_index_name1,
                keys: ["vector_id_2"]
            });
            await send(s3_vectors_client, delete_command);

            response = await send(s3_vectors_client, list_command);

            vectors.pop();
            compare_vectors(response.vectors, vectors, false);
        });

        mocha.it('should put a vector bucket policy', async function() {
            await create_vector_bucket(s3_vectors_client, created_vector_buckets, vector_bucket_name1);

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
            await create_vector_bucket(s3_vectors_client, created_vector_buckets, vector_bucket_name1);

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
            await create_vector_bucket(s3_vectors_client, created_vector_buckets, vector_bucket_name1);

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
                assert.strictEqual(err.name, 'ValidationException');
                assert.ok(err.message, 'Expected validation error message');
            }
        });

        mocha.it('should delete a vector bucket policy', async function() {
            await create_vector_bucket(s3_vectors_client, created_vector_buckets, vector_bucket_name1);

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

async function create_vector_bucket(client, create_vector_buckets, name, extra_params = {}) {
    const params = {
        vectorBucketName: name,
        ...extra_params
    };
    const command = new s3vectors.CreateVectorBucketCommand(params);
    await send(client, command);

    create_vector_buckets.push(name);
}

async function create_vector_index(client, create_vector_buckets, created_vector_indices, buc_name, ind_name) {
    await create_vector_bucket(client, create_vector_buckets, buc_name);

    const params = {
        vectorBucketName: buc_name,
        indexName: ind_name,
        dataType: s3vectors.DataType.FLOAT32,
        dimension: 3,
        distanceMetric: s3vectors.DistanceMetric.EUCLIDEAN
    };
    const command = new s3vectors.CreateIndexCommand(params);
    await send(client, command);

    created_vector_indices.push({
        vector_bucket: buc_name,
        vector_index: ind_name}
    );
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

function validate_vector_bucket(response_vb, expected_name, beforeTs, afterTs) {
    assert.strictEqual(response_vb.vectorBucketName, expected_name);
    const ts = response_vb.creationTime.getTime();
    assert(ts > beforeTs);
    assert(afterTs > ts);
}

function validate_vector_index(response_index, expected_vb_name, expected_index_name, beforeTs, afterTs) {
    assert.strictEqual(response_index.indexName, expected_index_name);
    assert.strictEqual(response_index.dataType, s3vectors.DataType.FLOAT32);
    assert.strictEqual(response_index.dimension, 3);
    assert.strictEqual(response_index.distanceMetric, s3vectors.DistanceMetric.EUCLIDEAN);

    validate_vector_bucket(response_index, expected_vb_name, beforeTs, afterTs);
}
