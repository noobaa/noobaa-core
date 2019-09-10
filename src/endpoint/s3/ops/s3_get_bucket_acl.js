/* Copyright (C) 2016 NooBaa */
'use strict';

const s3_utils = require('../s3_utils');
const _ = require('lodash');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETacl.html
 */
async function get_bucket_acl(req) {
    const bucket = await req.object_sdk.read_bucket({ name: req.params.bucket });
    const owner = {
        ID: bucket.owner_account.id.toString(),
        DisplayName: bucket.owner_account.email.unwrap()
    };
    _.defaults(owner, s3_utils.DEFAULT_S3_USER);
    return {
        AccessControlPolicy: {
            Owner: owner,
            AccessControlList: [{
                Grant: {
                    Grantee: {
                        _attr: {
                            'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
                            'xsi:type': 'CanonicalUser',
                        },
                        _content: owner,
                    },
                    Permission: 'FULL_CONTROL',
                }
            }]
        }
    };
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
