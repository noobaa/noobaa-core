/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectGETtagging.html
 */
async function get_object_tagging(req, res) {
    const reply = await req.object_sdk.get_object_tagging({
        bucket: req.params.bucket,
        key: req.params.key,
        version_id: req.query.versionId,
    });
    if (reply.version_id) res.setHeader('x-amz-version-id', reply.version_id);
    return format_tagging_response(reply.tagging);
}

function format_tagging_response(tag_set) {
    const tags_array = tag_set ? tag_set.map(tag => ({
        Tag: {
            Key: tag.key,
            Value: tag.value
        }
    })) : [];
    return {
        Tagging: {
            TagSet: tags_array
        }
    };
}

module.exports = {
    handler: get_object_tagging,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
