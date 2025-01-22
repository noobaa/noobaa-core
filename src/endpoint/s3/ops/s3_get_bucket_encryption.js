/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const S3Error = require('../s3_errors').S3Error;

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETencryption.html
 */
async function get_bucket_encryption(req) {
    const reply = await req.object_sdk.get_bucket_encryption({
        name: req.params.bucket
    });

    if (!reply.encryption) throw new S3Error(S3Error.ServerSideEncryptionConfigurationNotFoundError);

    const applied_encryption = {
        ApplyServerSideEncryptionByDefault: {
            SSEAlgorithm: reply.encryption.algorithm
        },
    };

    if (reply.encryption.kms_key_id) {
        applied_encryption.ApplyServerSideEncryptionByDefault.KMSMasterKeyID =
            reply.encryption.kms_key_id;
    }
    if (!_.isUndefined(reply.encryption.bucket_key_enabled)) {
        applied_encryption.BucketKeyEnabled =
            reply.encryption.bucket_key_enabled;
    }

    return {
        ServerSideEncryptionConfiguration: {
            Rule: [
                applied_encryption
            ]
        },
    };
}

module.exports = {
    handler: get_bucket_encryption,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
