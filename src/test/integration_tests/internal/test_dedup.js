/* Copyright (C) 2016 NooBaa */
/* eslint max-lines-per-function: ['error', 700] */
'use strict';
// setup coretest first to prepare the env
const coretest = require('../../utils/coretest/coretest');
coretest.setup({ pools_to_create: coretest.POOL_LIST });
const { S3 } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const http_utils = require('../../../util/http_utils');
const mocha = require('mocha');
const MDStore = require('../../../server/object_services/md_store').MDStore;
const assert = require('assert');
const config = require('../../../../config');

const { rpc_client, EMAIL } = coretest;
const BKT = 'dedup-sloth-bucket';
const FBODY = "THE MAJESTIC SLOTH";

mocha.describe('test_dedup', function() {

    let s3;

    mocha.before(async function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(60000);

        const account_info = await rpc_client.account.read_account({ email: EMAIL });
        s3 = new S3({
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
        });
        coretest.log('S3 CONFIG', s3.config);
    });

    mocha.it('Should create one chunk', async function() {
        await s3.createBucket({ Bucket: BKT });
        await s3.putObject({ Bucket: BKT, Key: 'FILE0', Body: FBODY });
        await s3.putObject({ Bucket: BKT, Key: 'FILE1', Body: FBODY });
        const chunks = await MDStore.instance().iterate_all_chunks();
        assert(chunks.chunk_ids.length === 1, 'Dedup did not happen and more than one chunk is created');
    });

});
