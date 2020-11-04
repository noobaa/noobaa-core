/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETMetricConfiguration.html
 */
async function get_bucket_metrics(req) {
    await req.object_sdk.read_bucket({ name: req.params.bucket });
    return {
        MetricsConfiguration: ''
    };
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
