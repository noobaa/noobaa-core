/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketDELETE.html
 */
function delete_bucket(req, res) {
    return req.rpc_client.bucket.delete_bucket({
        name: req.params.bucket
    }).return();
}

module.exports = {
    handler: delete_bucket,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
