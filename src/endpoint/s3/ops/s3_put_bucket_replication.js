/* Copyright (C) 2016 NooBaa */
'use strict';

const S3Error = require('../s3_errors').S3Error;

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTreplication.html
 */
function put_bucket_replication(req) {
    return req.object_sdk.read_bucket({ name: req.params.bucket })
        .then(bucket_info => {
            if (bucket_info.cloud_sync &&
                bucket_info.cloud_sync.status !== 'NOTSET') {
                throw new S3Error(S3Error.InvalidBucketState);
            }
            // TODO S3 put_bucket_replication not implemented
            throw new S3Error(S3Error.NotImplemented);
            // return req.object_sdk.set_bucket_replication({
            //     name: req.params.bucket,
            //     connection: '',
            //     target_bucket: '',
            //     policy: {
            //         schedule_min: 5
            //     }
            // });
        });
}

module.exports = {
    handler: put_bucket_replication,
    body: {
        type: 'xml',
    },
    reply: {
        type: 'empty',
    },
};
