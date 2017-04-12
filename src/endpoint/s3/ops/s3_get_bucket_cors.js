/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETcors.html
 */
function get_bucket_cors(req) {
    return req.rpc_client.bucket.read_bucket({ name: req.params.bucket })
        .then(bucket_info => ({
            CORSConfiguration: ''
        }));
}

module.exports = {
    handler: get_bucket_cors,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
