/* Copyright (C) 2023 NooBaa */
'use strict';

const AWS = require('aws-sdk');
const dbg = require('../../../util/debug_module')(__filename);
dbg.set_process_name('analyze_resource');
const SensitiveString = require('../../../util/sensitive_string');
const CloudVendor = require('./analyze_resource_cloud_vendor_abstract');
// Next lines were needed since ts(2304) on the JSDoc of the class
// Agent can be either from https or http (this is just a technical add)
const { Agent } = require('https'); // eslint-disable-line no-unused-vars 

/**
 * @typedef {{
 *      access_key: SensitiveString | string,
 *      secret_access_key: SensitiveString | string, 
 *      endpoint: string,
 *      signature_version: string,
 *      agent: Agent,
 * }} AnalyzeAwsSpec
 */

class AnalyzeAws extends CloudVendor {
    constructor(access_key, secret_access_key, endpoint, signature_version, agent) {
        super(); // Constructors for derived classes must contain a 'super' call.
        const s3_params = {
            endpoint: endpoint,
            accessKeyId: access_key instanceof SensitiveString ? access_key.unwrap() : access_key,
            secretAccessKey: secret_access_key instanceof SensitiveString ? secret_access_key.unwrap() : secret_access_key,
            s3ForcePathStyle: true,
            signatureVersion: signature_version,
            httpOptions: {
                agent,
            }
        };
        this.s3 = new AWS.S3(s3_params);
    }

    async list_objects(bucket) {
        const params = {
            Bucket: bucket,
            MaxKeys: CloudVendor.MAX_KEYS,
        };
        dbg.log0('Calling AWS listObjectsV2');
        const res = await this.s3.listObjectsV2(params).promise();
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
        const res = await this.s3.headObject(params).promise();
        dbg.log0(`Head of ${key} response: ${JSON.stringify(res, null, 4)}`);
    }

    async write_object(bucket, key) {
        const params = {
            Bucket: bucket,
            Key: key,
        };
        dbg.log0('Calling AWS putObject');
        const res = await this.s3.putObject(params).promise();
        dbg.log0(`Write of ${key} response: ${JSON.stringify(res, null, 4)}`);
    }

    async delete_object(bucket, key) {
        const params = {
            Bucket: bucket,
            Key: key,
        };
        dbg.log0('Calling AWS deleteObject');
        const res = await this.s3.deleteObject(params).promise();
        dbg.log0(`Delete of ${key} response: ${JSON.stringify(res, null, 4)}`); // getting empty response {}
    }
}

// EXPORTS
module.exports = AnalyzeAws;
