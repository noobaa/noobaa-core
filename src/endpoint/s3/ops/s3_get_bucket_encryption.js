/* Copyright (C) 2016 NooBaa */
'use strict';

const S3Error = require('../s3_errors').S3Error;

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETencryption.html
 */
async function get_bucket_encryption(req) {
    const reply = await req.object_sdk.get_bucket_encryption({
        name: req.params.bucket
    });

    if (!reply.encryption) throw new S3Error(S3Error.ServerSideEncryptionConfigurationNotFoundError);

    const rule_details = {
        SSEAlgorithm: reply.encryption.algorithm
    };

    if (reply.encryption.kms_key_id) rule_details.KMSMasterKeyID = reply.encryption.kms_key_id;

    return {
        ServerSideEncryptionConfiguration: {
            Rule: [{
                ApplyServerSideEncryptionByDefault: rule_details
            }]
        }
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
