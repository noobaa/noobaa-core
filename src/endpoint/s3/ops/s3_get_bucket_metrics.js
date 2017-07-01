/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETMetricConfiguration.html
 */
function get_bucket_metrics(req) {
    return req.object_sdk.read_bucket({ name: req.params.bucket })
        .then(bucket_info => ({
            MetricsConfiguration: ''
        }));
}

module.exports = {
    handler: get_bucket_metrics,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
