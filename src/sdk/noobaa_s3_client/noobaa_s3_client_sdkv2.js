/* Copyright (C) 2023 NooBaa */
'use strict';

const AWS = require('aws-sdk');
require('aws-sdk/lib/maintenance_mode_message').suppress = true;

/**
 * S3 Object AWS SDK V2:
 * https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html
 */

class S3ClientSDKV2 {
    constructor(params) {
        this.s3 = new AWS.S3(params);
    }

    abortMultipartUpload(params) {
        return this.s3.abortMultipartUpload(params).promise();
    }

    copyObject(params) {
        return this.s3.copyObject(params).promise();
    }

    completeMultipartUpload(params) {
        return this.s3.completeMultipartUpload(params).promise();
    }

    createMultipartUpload(params) {
        return this.s3.createMultipartUpload(params).promise();
    }

    deleteObject(params) {
        return this.s3.deleteObject(params).promise();
    }

    deleteObjects(params) {
        return this.s3.deleteObjects(params).promise();
    }

    deleteObjectTagging(params) {
        return this.s3.deleteObjectTagging(params).promise();
    }

    getObject(params) {
        return this.s3.getObject(params).promise();
    }

    getObjectAcl(params) {
        return this.s3.getObjectAcl(params).promise();
    }

    getObjectTagging(params) {
        return this.s3.getObjectTagging(params).promise();
    }

    headObject(params) {
        return this.s3.headObject(params).promise();
    }

    listBuckets(params) {
        return this.s3.listBuckets(params).promise();
    }

    listMultipartUploads(params) {
        return this.s3.listMultipartUploads(params).promise();
    }

    listObjects(params) {
        return this.s3.listObjects(params).promise();
    }

    listObjectsV2(params) {
        return this.s3.listObjectsV2(params).promise();
    }

    listObjectVersions(params) {
        return this.s3.listObjectVersions(params).promise();
    }

    listParts(params) {
        return this.s3.listParts(params).promise();
    }

    putObject(params) {
        return this.s3.putObject(params).promise();
    }

    putObjectAcl(params) {
        return this.s3.putObjectAcl(params).promise();
    }

    putObjectTagging(params) {
        return this.s3.putObjectTagging(params).promise();
    }

    uploadPart(params) {
        return this.s3.uploadPart(params).promise();
    }

    uploadPartCopy(params) {
        return this.s3.uploadPartCopy(params).promise();
    }

}

// EXPORTS
exports.S3ClientSDKV2 = S3ClientSDKV2;
