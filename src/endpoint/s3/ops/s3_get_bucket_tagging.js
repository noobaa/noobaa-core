/* Copyright (C) 2016 NooBaa */
'use strict';

const { RpcError } = require('../../../rpc');
/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETtagging.html
 */
async function get_bucket_tagging(req) {
    const reply = await req.object_sdk.get_bucket_tagging({
        name: req.params.bucket
    });
    return format_tagging_response(reply.tagging);
}

function format_tagging_response(tag_set) {
    const tags_array = tag_set ? tag_set.map(tag => ({
        Tag: {
            Key: tag.key,
            Value: tag.value
        }
    })) : [];
    if (!tags_array.length) {
        throw new RpcError('NO_SUCH_TAG', 'Tagging not found');
    }
    return {
        Tagging: {
            TagSet: tags_array
        }
    };
}

module.exports = {
    handler: get_bucket_tagging,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
