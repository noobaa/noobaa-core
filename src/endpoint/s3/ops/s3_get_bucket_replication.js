/* Copyright (C) 2016 NooBaa */
'use strict';

const S3Error = require('../s3_errors').S3Error;
const s3_utils = require('../s3_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETreplication.html
 */
function get_bucket_replication(req) {
    return req.rpc_client.bucket.read_bucket({ name: req.params.bucket })
        .then(bucket_info => {
            if (!bucket_info.cloud_sync ||
                bucket_info.cloud_sync.status === 'NOTSET') {
                throw new S3Error(S3Error.ReplicationConfigurationNotFoundError);
            }
            return {
                ReplicationConfiguration: {
                    Role: `arn:noobaa:iam::112233445566:role/CloudSync`,
                    Rule: {
                        ID: 'CloudSync',
                        Status: bucket_info.cloud_sync.policy.paused ? 'Disabled' : 'Enabled',
                        Prefix: '',
                        Destination: {
                            Bucket: bucket_info.cloud_sync.target_bucket,
                            StorageClass: s3_utils.STORAGE_CLASS_STANDARD,
                            // non standard fields
                            Endpoint: bucket_info.cloud_sync.endpoint,
                            EndpointType: bucket_info.cloud_sync.endpoint_type,
                        }
                    }
                }
            };
        });
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
