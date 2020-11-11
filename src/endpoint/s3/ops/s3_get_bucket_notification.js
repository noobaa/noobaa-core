/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETnotification.html
 */
async function get_bucket_notification(req) {
    await req.object_sdk.read_bucket({ name: req.params.bucket });
    return {
        NotificationConfiguration: ''
    };
}

module.exports = {
    handler: get_bucket_notification,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
