/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketDELETEInventoryConfiguration.html
 */
async function delete_bucket_inventory(req) {
    await req.object_sdk.read_bucket({ name: req.params.bucket });
    // TODO S3 delete_bucket_inventory not implemented
}

module.exports = {
    handler: delete_bucket_inventory,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
