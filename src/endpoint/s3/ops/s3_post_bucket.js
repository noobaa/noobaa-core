/* Copyright (C) 2016 NooBaa */
'use strict';

const S3Error = require('../s3_errors').S3Error;

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectPOST.html
 * AKA upload using HTTP multipart/form-data encoding
 */
function post_object(req) {
    // TODO S3 post_object not implemented
    throw new S3Error(S3Error.NotImplemented);

}

module.exports = {
    handler: post_object,
    body: {
        type: 'raw',
    },
    reply: {
        type: 'xml',
    },
};
