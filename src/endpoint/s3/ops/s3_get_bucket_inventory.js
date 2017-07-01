/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETInventoryConfig.html
 */
function get_bucket_inventory(req) {
    return req.object_sdk.read_bucket({ name: req.params.bucket })
        .then(bucket_info => ({
            InventoryConfiguration: ''
        }));
}

module.exports = {
    handler: get_bucket_inventory,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
