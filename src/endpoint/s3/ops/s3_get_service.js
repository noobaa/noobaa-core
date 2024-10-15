/* Copyright (C) 2016 NooBaa */
'use strict';

const s3_utils = require('../s3_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTServiceGET.html
 */
async function list_buckets(req) {

    const params = {
        continuation_token: s3_utils.cont_tok_to_key_marker(req.query['continuation-token']),
        max_buckets: req.query['max-buckets'] ? Number(req.query['max-buckets']) : undefined
    };

    const reply = await req.object_sdk.list_buckets(params);
    const date = s3_utils.format_s3_xml_date(new Date());
    const bucket_cont_token = s3_utils.key_marker_to_cont_tok(reply.continuation_token, null, false);
    // const bucket_cont_token = bucket_name_to_cont_token(reply.continuation_token);

    return {
        ListAllMyBucketsResult: {
            Owner: s3_utils.DEFAULT_S3_USER,
            Buckets: reply.buckets.map(bucket => ({
                Bucket: {
                    Name: bucket.name.unwrap(),
                    CreationDate: bucket.creation_date ? s3_utils.format_s3_xml_date(bucket.creation_date) : date,
                }
            })),
            ContinuationToken: bucket_cont_token,
        }
    };
}

module.exports = {
    handler: list_buckets,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
