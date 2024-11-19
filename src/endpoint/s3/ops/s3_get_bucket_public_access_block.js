/* Copyright (C) 2024 NooBaa */
'use strict';

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetPublicAccessBlock.html
 */
async function get_public_access_block(req) {
    const reply = await req.object_sdk.get_public_access_block({ name: req.params.bucket });
    if (!reply.public_access_block) {
        return {
            PublicAccessBlockConfiguration: {
                BlockPublicAcls: false,
                IgnorePublicAcls: false,
                BlockPublicPolicy: false,
                RestrictPublicBuckets: false,
            }
        };
    }

    return {
        PublicAccessBlockConfiguration: {
            BlockPublicAcls: Boolean(reply.public_access_block.block_public_acls),
            IgnorePublicAcls: Boolean(reply.public_access_block.ignore_public_acls),
            BlockPublicPolicy: Boolean(reply.public_access_block.block_public_policy),
            RestrictPublicBuckets: Boolean(reply.public_access_block.restrict_public_buckets),
        }
    };
}

module.exports = {
    handler: get_public_access_block,
    body: {
        type: 'empty'
    },
    reply: {
        type: 'xml',
    },
};

