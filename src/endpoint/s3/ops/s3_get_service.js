/* Copyright (C) 2016 NooBaa */
'use strict';

const s3_utils = require('../s3_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTServiceGET.html
 */
async function list_buckets(req) {
    const reply = await req.object_sdk.list_buckets();
    const date = s3_utils.format_s3_xml_date(new Date());
    return {
        ListAllMyBucketsResult: {
            Owner: s3_utils.DEFAULT_S3_USER,
            Buckets: reply.buckets.map(bucket => ({
                Bucket: {
                    Name: bucket.name.unwrap(),
                    CreationDate: date,
                }
            }))
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
