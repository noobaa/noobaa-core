/* Copyright (C) 2025 NooBaa */
/* eslint-disable no-invalid-this */

'use strict';
// setup coretest first to prepare the env
const coretest = require('../../../utils/coretest/coretest');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[1]] });
const config = require('../../../../../config');
const { S3 } = require('@aws-sdk/client-s3');
const s3vectors = require('@aws-sdk/client-s3vectors');
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const mocha = require('mocha');
const assert = require('assert');
const https = require('https');
const { rpc_client, EMAIL } = coretest;
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
        self.timeout(10000);
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
        s3_vectors_client = new s3vectors.S3VectorsClient(client_params);
        coretest.log('VECTORS S3 CONFIG', s3_vectors_client.config);

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
        s3_client = new S3(s3_client_params);
    });

    mocha.describe('vector-bucket-ops', function() {

        const vector_bucket_name1 = 'test-vec-buc1';

        mocha.beforeEach(async function() {
            await s3_client.createBucket({ Bucket: 'lance' });
        });

        mocha.afterEach(async function() {

            const command = new s3vectors.DeleteVectorBucketCommand({
                vectorBucketName: vector_bucket_name1
            });
            await s3_vectors_client.send(command);

            await s3_client.deleteBucket({ Bucket: 'lance' });
        });

        mocha.it('should create a vector bucket', async function() {
            await create_vector_bucket(s3_vectors_client, vector_bucket_name1);
        });

        mocha.it('should list vector buckets', async function() {
            await create_vector_bucket(s3_vectors_client, vector_bucket_name1);

            const command = new s3vectors.ListVectorBucketsCommand();
            const response = await s3_vectors_client.send(command);

            console.log("list vectors response = ", response);

        });
    });
});

async function create_vector_bucket(client, name) {
            const params = {
                vectorBucketName: name
            };
            const command = new s3vectors.CreateVectorBucketCommand(params);
            const response = await client.send(command);
            assert_response_ok(response);
}

function assert_response_ok(response) {
    assert.strictEqual(response.$metadata.httpStatusCode, 200);
    assert.strictEqual(response.$metadata.attempts, 1);
    assert(response.$metadata.requestId);
    assert(response.$metadata.extendedRequestId);
}
