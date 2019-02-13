/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const s3_utils = require('../s3_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTServiceGET.html
 */
function list_buckets(req) {
    return req.object_sdk.list_buckets()
        .then(reply => {
            let date = s3_utils.format_s3_xml_date(new Date());
            return {
                ListAllMyBucketsResult: {
                    Owner: s3_utils.DEFAULT_S3_USER,
                    Buckets: _.map(reply.buckets, bucket => ({
                        Bucket: {
                            Name: bucket.name.unwrap(),
                            CreationDate: date
                        }
                    }))
                }
            };
        });
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
