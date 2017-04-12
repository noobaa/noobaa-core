/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketDELETEpolicy.html
 */
function delete_bucket_policy(req) {
    return req.rpc_client.bucket.read_bucket({ name: req.params.bucket })
        .then(bucket_info => {
            // TODO S3 delete_bucket_policy not implemented
        });
}

module.exports = {
    handler: delete_bucket_policy,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
