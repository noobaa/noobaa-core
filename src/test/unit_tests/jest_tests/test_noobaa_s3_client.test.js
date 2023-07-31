/* Copyright (C) 2023 NooBaa */
/* eslint-disable no-undef */
'use strict';

const { S3 } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@aws-sdk/node-http-handler');
const { Agent } = require('http');
const { S3ClientSDKV2 } = require('../../../sdk/noobaa_s3_client/noobaa_s3_client_sdkv2');
const noobaa_s3_client = require('../../../sdk/noobaa_s3_client/noobaa_s3_client');
const config = require('../../../../config');

describe('noobaa_s3_client get_s3_client_v3_params', () => {

    describe('use AWS SDK V2', () => {

        it('should choose by signatureVersion v2', () => {
            config.AWS_SDK_VERSION_3_DISABLED = false;
            const signature_version = 'v2';
            const params = {
                signatureVersion: signature_version,
            };
            const s3 = noobaa_s3_client.get_s3_client_v3_params(params);
            expect(s3).toBeInstanceOf(S3ClientSDKV2);
        });

        it('should choose by workaround config', () => {
            config.AWS_SDK_VERSION_3_DISABLED = true;
            const signature_version = 'v4';
            const params = {
                signatureVersion: signature_version,
            };
            const s3 = noobaa_s3_client.get_s3_client_v3_params(params);
            expect(s3).toBeInstanceOf(S3ClientSDKV2);
        });
    });

    describe('use AWS SDK V3', () => {

        it('should choose by default', () => {
            config.AWS_SDK_VERSION_3_DISABLED = false;
            const params = {};
            const s3 = noobaa_s3_client.get_s3_client_v3_params(params);
            expect(s3).toBeInstanceOf(S3);
        });

        it('should choose by signatureVersion v4', () => {
            config.AWS_SDK_VERSION_3_DISABLED = false;
            const signature_version = 'v4';
            const params = {
                signatureVersion: signature_version,
            };
            const s3 = noobaa_s3_client.get_s3_client_v3_params(params);
            expect(s3).toBeInstanceOf(S3);
        });

    });

});

describe('noobaa_s3_client change_s3_client_params_to_v2_structure', () => {

    it('v2: s3ForcePathStyle, v3: forcePathStyle', () => {
        const params = {
            forcePathStyle: true,
        };
        noobaa_s3_client.change_s3_client_params_to_v2_structure(params);
        expect(params.s3ForcePathStyle).toBe(true);
        expect(params.forcePathStyle).toBeUndefined();
    });

    it('v2: sslEnabled, v3: tls', () => {
        const params = {
            tls: true,
        };
        noobaa_s3_client.change_s3_client_params_to_v2_structure(params);
        expect(params.sslEnabled).toBe(true);
        expect(params.tls).toBeUndefined();
    });

    it('v2: s3BucketEndpoint, v3: bucketEndpoint', () => {
        const params = {
            bucketEndpoint: true,
        };
        noobaa_s3_client.change_s3_client_params_to_v2_structure(params);
        expect(params.s3BucketEndpoint).toBe(true);
        expect(params.bucketEndpoint).toBeUndefined();
    });

        it('v2: httpOptions, v3: requestHandler', () => {
            const params = {
                endpoint: 'http://127.0.0.1:8080',
                requestHandler: new NodeHttpHandler({
                    httpAgent: new Agent({
                        /*Agent params*/
                    }),
                })
            };
            noobaa_s3_client.change_s3_client_params_to_v2_structure(params);
            expect(params).toHaveProperty('httpOptions');
            expect(params.requestHandler).toBeUndefined();
        });

});

describe('noobaa_s3_client get_region', () => {
    // global endpoint is 's3.amazonaws.com'
    it('aws non-global endpoint without region', async () => {
        const params = {
            endpoint: 'https://s3.us-west-1.amazonaws.com',
        };
        const region = await noobaa_s3_client.get_region(params);
        expect(region).toBe('us-west-1');
    });

    it('aws global endpoint with region', async () => {
        const params = {
            endpoint: 'https://s3.amazonaws.com',
            region: 'us-west-1'
        };
        const region = await noobaa_s3_client.get_region(params);
        expect(region).toBe('us-west-1');
    });

});

describe('noobaa_s3_client edit_global_aws_endpoint', () => {
    // global endpoint is 's3.amazonaws.com'
    it('aws non-global endpoint', () => {
        const endpoint = 'https://s3.us-west-1.amazonaws.com';
        const region = 'us-west-1';
        const endpoint_non_global = noobaa_s3_client.get_non_global_aws_endpoint(endpoint, region);
        expect(endpoint_non_global).toBe('https://s3.us-west-1.amazonaws.com');
    });

    it('aws non-global endpoint (https)', () => {
        const endpoint = 'https://s3.amazonaws.com';
        const region = 'us-west-1';
        const endpoint_non_global = noobaa_s3_client.get_non_global_aws_endpoint(endpoint, region);
        expect(endpoint_non_global).toBe('https://s3.us-west-1.amazonaws.com');
    });

    it('aws non-global endpoint (http)', () => {
        const endpoint = 'http://s3.amazonaws.com';
        const region = 'us-west-1';
        const endpoint_non_global = noobaa_s3_client.get_non_global_aws_endpoint(endpoint, region);
        expect(endpoint_non_global).toBe('http://s3.us-west-1.amazonaws.com');
    });

});
