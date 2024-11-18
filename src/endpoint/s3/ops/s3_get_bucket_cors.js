/* Copyright (C) 2016 NooBaa */
'use strict';

const S3Error = require('../s3_errors').S3Error;

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETcors.html
 */
async function get_bucket_cors(req) {
    const reply = await req.object_sdk.get_bucket_cors({ name: req.params.bucket });
    if (!reply.cors.length) throw new S3Error(S3Error.NoSuchCORSConfiguration);
    const cors_rules = reply.cors.map(rule => {
        const new_rule = [];
        new_rule.push(...rule.allowed_methods.map(m => ({ AllowedMethod: m })));
        new_rule.push(...rule.allowed_origins.map(o => ({ AllowedOrigin: o })));
        if (rule.allowed_headers) new_rule.push(...rule.allowed_headers.map(h => ({ AllowedHeader: h })));
        if (rule.expose_headers) new_rule.push(...rule.expose_headers.map(e => ({ ExposeHeader: e })));
        if (rule.id) new_rule.push({ ID: rule.id });
        if (rule.max_age_seconds) new_rule.push({ MaxAgeSeconds: rule.max_age_seconds });
        return { CORSRule: new_rule };
    });
    return { CORSConfiguration: cors_rules.length ? cors_rules : '' };
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
