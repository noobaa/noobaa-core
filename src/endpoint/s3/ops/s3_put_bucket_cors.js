/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const { S3Error } = require('../s3_errors');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTcors.html
 */
async function put_bucket_cors(req) {
    const allowedList = ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'];
    const cors_rules = req.body.CORSConfiguration.CORSRule.map(rule => {
        const unsupported_method = rule.AllowedMethod.find(item => !allowedList.includes(item));
        if (unsupported_method) {
            throw new S3Error({
                ...S3Error.InvalidRequest,
                message: `Found unsupported HTTP method in CORS config. Unsupported method is ${unsupported_method}`
            });
        }
        const wildcard_expose_header = rule.ExposeHeader?.find(item => item.includes('*'));
        if (wildcard_expose_header) {
            throw new S3Error({
                ...S3Error.InvalidRequest,
                message: `ExposeHeader "${wildcard_expose_header}" contains wildcard. We currently do not support wildcard for ExposeHeader.`
            });
        }
        return _.omitBy({
            allowed_headers: rule.AllowedHeader,
            allowed_methods: rule.AllowedMethod,
            allowed_origins: rule.AllowedOrigin,
            expose_headers: rule.ExposeHeader,
            id: rule.ID?.[0],
            max_age_seconds: rule.MaxAgeSeconds && parseInt(rule.MaxAgeSeconds, 10),
        }, _.isUndefined);
    });
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
