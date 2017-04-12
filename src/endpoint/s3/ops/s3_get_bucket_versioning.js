/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETversioningStatus.html
 */
function get_bucket_versioning(req) {
    return req.rpc_client.bucket.read_bucket({
            name: req.params.bucket
        })
        .then(bucket_info => ({
            VersioningConfiguration: {}
        }));
}

module.exports = {
    handler: get_bucket_versioning,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
