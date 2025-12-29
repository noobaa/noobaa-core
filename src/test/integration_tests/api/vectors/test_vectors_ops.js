/* Copyright (C) 2025 NooBaa */
/* eslint-disable no-invalid-this */

'use strict';
// setup coretest first to prepare the env
const coretest = require('../../../utils/coretest/coretest');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[1]] });
const config = require('../../../../../config');
const s3vectors = require('@aws-sdk/client-s3vectors');
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const mocha = require('mocha');
const assert = require('assert');
const https = require('https');
const { rpc_client, EMAIL } = coretest;

mocha.describe('vectors_ops', function() {

    let client;
    /** @type {import("@aws-sdk/client-s3vectors").S3VectorsClientConfig} */
    let client_params;

    mocha.before(async function() {
        const self = this;
        self.timeout(10000);
        const account_info = await rpc_client.account.read_account({ email: EMAIL, });
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
        client = new s3vectors.S3VectorsClient(client_params);
        coretest.log('VECTORS S3 CONFIG', client.config);
    });

    mocha.describe('vector-bucket-ops', function() {
        this.timeout(10000);
        mocha.it('should create a vector bucket', async function() {
            const params = {
                vectorBucketName: 'test-vec-buc1'
            };
            const command = new s3vectors.CreateVectorBucketCommand(params);
            const response = await client.send(command);
            assert_response_ok(response);
        });
    });
});

function assert_response_ok(response) {
    assert.strictEqual(response.$metadata.httpStatusCode, 200);
    assert.strictEqual(response.$metadata.attempts, 1);
    assert(response.$metadata.requestId);
    assert(response.$metadata.extendedRequestId);
}
