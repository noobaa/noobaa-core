/* Copyright (C) 2024 NooBaa */
'use strict';

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeletePublicAccessBlock.html
 */
async function delete_public_access_block(req) {
    await req.object_sdk.delete_public_access_block({ name: req.params.bucket });
}

module.exports = {
    handler: delete_public_access_block,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};

