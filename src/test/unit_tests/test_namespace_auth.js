/* Copyright (C) 2016 NooBaa */
/* eslint max-lines-per-function: ['error', 700] */
'use strict';
// setup coretest first to prepare the env
const coretest = require('./coretest');
const buffer_utils = require('../../util/buffer_utils');
coretest.setup({ pools_to_create: coretest.POOL_LIST });
const AWS = require('aws-sdk');
const http_utils = require('../../util/http_utils');
const mocha = require('mocha');
const assert = require('assert');

const { rpc_client, EMAIL } = coretest;
const BUCKET = 'first.bucket';
const CONNECTION_NAME = 'ns_auth_con';
const NAMESPACE_RESOURCE_NAME = 'nsr_auth';
const NS_BUCKET = 'nsb';
const BODY = "THE_MAJESTIC_SLOTH";
const FKEY = 'ns_auth_file';

mocha.describe('Namespace Auth', function() {

    let s3;
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
        const nsr = { resource: NAMESPACE_RESOURCE_NAME };
        const read_resources = [nsr];
        const write_resource = nsr;
        await rpc_client.account.add_external_connection({
            name: CONNECTION_NAME,
            endpoint: coretest.get_http_address(),
            endpoint_type: 'S3_COMPATIBLE',
            identity: account_info.access_keys[0].access_key.unwrap(),
            secret: account_info.access_keys[0].secret_key.unwrap(),
        });
        await rpc_client.pool.create_namespace_resource({
            name: NAMESPACE_RESOURCE_NAME,
            connection: CONNECTION_NAME,
            target_bucket: BUCKET
        });
        await rpc_client.bucket.create_bucket({ name: NS_BUCKET, namespace: { read_resources, write_resource } });
    });

    mocha.it('Put object', async function() {
        await s3.putObject({ Bucket: NS_BUCKET, Key: FKEY, Body: BODY }).promise();
    });

    mocha.it('Get object', async function() {
        await s3.getObject({ Bucket: NS_BUCKET, Key: FKEY }).promise();
    });

    mocha.it('Get object without auth', async function() {
        let response;
        let parsed_body;
        try {
            const url = new URL(coretest.get_https_address());
            response = await http_utils.make_https_request({
                method: 'GET',
                hostname: url.hostname,
                port: url.port,
                path: `/${NS_BUCKET}/${FKEY}`,
                rejectUnauthorized: false,
            });
            const buffer = await buffer_utils.read_stream_join(response);
            const body = buffer.toString('utf8');
            parsed_body = await http_utils.parse_xml_to_js(body);
        } catch (error) {
            console.error(error);
            throw new Error('Expected to get a response with XML failure');
        }
        assert(parsed_body.Error, 'Did not get error');
        assert(parsed_body.Error.Code[0] === 'AccessDenied', 'Did not get error code AccessDenied');
        assert(parsed_body.Error.Message[0] === 'Access Denied', 'Did not get error message Access Denied');
        assert(response.statusCode === 403, 'Did not get status code 403');
    });

});