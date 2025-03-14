/* Copyright (C) 2024 NooBaa */
'use strict';

const s3_utils = require('../s3_utils');

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutPublicAccessBlock.html
 * @param {nb.S3Request} req 
 * @param {nb.S3Response} res 
 */
async function put_public_access_block(req, res) {
    const public_access_block = s3_utils.parse_body_public_access_block(req);
    await req.object_sdk.put_public_access_block({ name: req.params.bucket, public_access_block });
}

module.exports = {
    handler: put_public_access_block,
    body: {
        type: 'xml',
    },
    reply: {
        type: 'empty',
    },
};

