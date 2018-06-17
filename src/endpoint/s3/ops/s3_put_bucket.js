/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUT.html
 */
async function put_bucket(req, res) {
    await req.object_sdk.create_bucket({ name: req.params.bucket });
    res.setHeader('Location', '/' + req.params.bucket);
}

module.exports = {
    handler: put_bucket,
    body: {
        type: 'xml',
        // body is optional since it may contain region name (location constraint)
        // or use the default US East region when not included
        optional: true,
    },
    reply: {
        type: 'empty',
    },
};
