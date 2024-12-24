/* Copyright (C) 2024 NooBaa */
'use strict';

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetPublicAccessBlock.html
 */
async function get_public_access_block(req) {
    const reply = await req.object_sdk.get_public_access_block({ name: req.params.bucket });
    if (!reply.public_access_block) {
        return {
            block_public_acls: false,
            ignore_public_acls: false,
            block_public_policy: false,
            restrict_public_buckets: false,
        };
    }

    return {
        block_public_acls: Boolean(reply.public_access_block.block_public_acls),
        ignore_public_acls: Boolean(reply.public_access_block.ignore_public_acls),
        block_public_policy: Boolean(reply.public_access_block.block_public_policy),
        restrict_public_buckets: Boolean(reply.public_access_block.restrict_public_buckets),
    };
}

module.exports = {
    handler: get_public_access_block,
    body: {
        type: 'empty'
    },
    reply: {
        type: 'json',
    },
};

