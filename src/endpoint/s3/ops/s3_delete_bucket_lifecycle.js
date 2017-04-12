/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketDELETElifecycle.html
 */
function delete_bucket_lifecycle(req, res) {
    return req.rpc_client.bucket.delete_bucket_lifecycle({
        name: req.params.bucket
    }).return();
}

module.exports = {
    handler: delete_bucket_lifecycle,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
