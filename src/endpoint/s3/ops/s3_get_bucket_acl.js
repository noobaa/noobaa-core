/* Copyright (C) 2016 NooBaa */
'use strict';

const s3_utils = require('../s3_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETacl.html
 */
function get_bucket_acl(req) {
    return req.object_sdk.read_bucket({ name: req.params.bucket })
        .then(bucket_info => ({
            AccessControlPolicy: {
                Owner: s3_utils.DEFAULT_S3_USER,
                AccessControlList: [{
                    Grant: {
                        Grantee: {
                            _attr: {
                                'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
                                'xsi:type': 'CanonicalUser',
                            },
                            _content: s3_utils.DEFAULT_S3_USER,
                        },
                        Permission: 'FULL_CONTROL',
                    }
                }]
            }
        }));
}

module.exports = {
    handler: get_bucket_acl,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
