/* Copyright (C) 2016 NooBaa */
'use strict';

const s3_utils = require('../s3_utils');

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectDELETEtagging.html
 */
async function delete_object_tagging(req, res) {
    req.s3event = 'ObjectTagging';
    const reply = await req.object_sdk.delete_object_tagging({
        bucket: req.params.bucket,
        key: req.params.key,
        version_id: s3_utils.parse_version_id(req.query.versionId),
    });
    if (reply.version_id) res.setHeader('x-amz-version-id', reply.version_id);
}
module.exports = {
    handler: delete_object_tagging,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
