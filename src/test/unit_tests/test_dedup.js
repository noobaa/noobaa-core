/* Copyright (C) 2016 NooBaa */
/* eslint max-lines-per-function: ['error', 700] */
'use strict';
// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup({ pools_to_create: coretest.POOL_LIST });
const AWS = require('aws-sdk');
const http_utils = require('../../util/http_utils');
const mocha = require('mocha');
const MDStore = require('../../server/object_services/md_store').MDStore;
const assert = require('assert');

const { rpc_client, EMAIL } = coretest;
const BKT = 'dedup-sloth-bucket';
const FBODY = "THE MAJESTIC SLOTH";

mocha.describe('test_dedup', function() {

    let s3;

    mocha.before(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);

        const account_info = await rpc_client.account.read_account({ email: EMAIL });
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

    mocha.it('Should create one chunk', async function() {
        await s3.createBucket({ Bucket: BKT }).promise();
        await s3.putObject({ Bucket: BKT, Key: 'FILE0', Body: FBODY }).promise();
        await s3.putObject({ Bucket: BKT, Key: 'FILE1', Body: FBODY }).promise();
        const chunks = await MDStore.instance().iterate_all_chunks();
        assert(chunks.chunk_ids.length === 1, 'Dedup did not happen and more than one chunk is created');
    });

});
