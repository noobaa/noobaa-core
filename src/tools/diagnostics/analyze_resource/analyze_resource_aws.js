/* Copyright (C) 2023 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
dbg.set_process_name('analyze_resource');
const SensitiveString = require('../../../util/sensitive_string');
const CloudVendor = require('./analyze_resource_cloud_vendor_abstract');
const noobaa_s3_client = require('../../../sdk/noobaa_s3_client/noobaa_s3_client');
const config = require('../../../../config');

/**
 * @typedef {{
 *      access_key: SensitiveString | string,
 *      secret_access_key: SensitiveString | string, 
 *      endpoint: string,
 *      signature_version: string,
 *      region?: string,
 * }} AnalyzeAwsSpec
 */

class AnalyzeAws extends CloudVendor {
    constructor(access_key, secret_access_key, endpoint, signature_version, region) {
        super(); // Constructors for derived classes must contain a 'super' call.
        const s3_params = {
            credentials: {
                accessKeyId: access_key instanceof SensitiveString ? access_key.unwrap() : access_key,
                secretAccessKey: secret_access_key instanceof SensitiveString ? secret_access_key.unwrap() : secret_access_key,
            },
            endpoint: endpoint,
            region: region || config.DEFAULT_REGION, // set config.DEFAULT_REGION to avoid missing region error in aws sdk v3
            forcePathStyle: true,
            signatureVersion: signature_version,
            requestHandler: noobaa_s3_client.get_requestHandler_with_suitable_agent(endpoint),
        };
        this.s3 = noobaa_s3_client.get_s3_client_v3_params(s3_params);
    }

    async list_objects(bucket) {
        const params = {
            Bucket: bucket,
            MaxKeys: CloudVendor.MAX_KEYS,
        };
        dbg.log0('Calling AWS listObjectsV2');
        const res = await this.s3.listObjectsV2(params);
        dbg.log0(`List object response: ${JSON.stringify(res, null, 4)}`);

        this.key = '';
        if (res && res.KeyCount > 0) {
            this.key = res.Contents[0].Key;
        }
    }

    async get_key() {
        return this.key;
    }

    async head_object(bucket, key) {
        const params = {
            Bucket: bucket,
            Key: key,
        };
        dbg.log0('Calling AWS headObject');
        const res = await this.s3.headObject(params);
        dbg.log0(`Head of ${key} response: ${JSON.stringify(res, null, 4)}`);
    }

    async write_object(bucket, key) {
        const params = {
            Bucket: bucket,
            Key: key,
        };
        dbg.log0('Calling AWS putObject');
        const res = await this.s3.putObject(params);
        dbg.log0(`Write of ${key} response: ${JSON.stringify(res, null, 4)}`);
    }

    async delete_object(bucket, key) {
        const params = {
            Bucket: bucket,
            Key: key,
        };
        dbg.log0('Calling AWS deleteObject');
        const res = await this.s3.deleteObject(params);
        dbg.log0(`Delete of ${key} response: ${JSON.stringify(res, null, 4)}`); // getting empty response {}
    }
}

// EXPORTS
module.exports = AnalyzeAws;
