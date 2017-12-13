/* Copyright (C) 2016 NooBaa */
'use strict';

const s3_utils = require('../s3_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectGETacl.html
 */
function get_object_acl(req) {
    return req.object_sdk.read_object_md({
            bucket: req.params.bucket,
            key: req.params.key,
        })
        .then(object_md => ({
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
                        Permission: 'FULL_CONTROL'
                    }
                }]
            }
        }));
}

module.exports = {
    handler: get_object_acl,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
