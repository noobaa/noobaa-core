/* Copyright (C) 2016 NooBaa */
'use strict';

const S3Error = require('../s3_errors').S3Error;
// const s3_utils = require('../s3_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETreplication.html
 */
async function get_bucket_replication(req) {
    await req.object_sdk.read_bucket({ name: req.params.bucket });
    // TODO S3 get_bucket_replication not implemented
    throw new S3Error(S3Error.ReplicationConfigurationNotFoundError);

    /*
    return {
        ReplicationConfiguration: {
            Role: `arn:noobaa:iam::112233445566:role/replication`,
            Rule: {
                ID: 'replication',
                Status: status ? 'Enabled': 'Disabled',
                Prefix: '',
                Destination: {
                    Bucket: target.bucket,
                    StorageClass: s3_utils.STORAGE_CLASS_STANDARD,
                    // non standard fields
                    Endpoint: target.endpoint,
                    EndpointType: target.endpoint_type,
                }
            }
        }
    };
    */
}

module.exports = {
    handler: get_bucket_replication,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
