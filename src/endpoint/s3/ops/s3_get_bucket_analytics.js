/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETAnalyticsConfig.html
 */
function get_bucket_analytics(req) {
    return req.object_sdk.read_bucket({ name: req.params.bucket })
        .then(bucket_info => ({
            AnalyticsConfiguration: ''
        }));
}

module.exports = {
    handler: get_bucket_analytics,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
