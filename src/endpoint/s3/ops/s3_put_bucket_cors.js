/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTcors.html
 */
async function put_bucket_cors(req) {
    const cors_rules = req.body.CORSConfiguration.CORSRule.map(rule =>
        _.omitBy({
            allowed_headers: rule.AllowedHeader,
            allowed_methods: rule.AllowedMethod,
            allowed_origins: rule.AllowedOrigin,
            expose_headers: rule.ExposeHeader,
            id: rule.ID,
            max_age_seconds: rule.MaxAgeSeconds && parseInt(rule.MaxAgeSeconds, 10),
        }, _.isUndefined)
    );
    await req.object_sdk.put_bucket_cors({
        name: req.params.bucket,
        cors_rules
    });
}

module.exports = {
    handler: put_bucket_cors,
    body: {
        type: 'xml',
    },
    reply: {
        type: 'empty',
    },
};
