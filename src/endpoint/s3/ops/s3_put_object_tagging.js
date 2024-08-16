/* Copyright (C) 2016 NooBaa */
'use strict';

const s3_utils = require('../s3_utils');

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectPUTtagging.html
 */
async function put_object_tagging(req, res) {
    const tag_set = s3_utils.parse_body_tagging_xml(req);
    const version_id = s3_utils.parse_version_id(req.query.versionId);
    req.s3event = 'ObjectTagging';
    const reply = await req.object_sdk.put_object_tagging({
        bucket: req.params.bucket,
        key: req.params.key,
        tagging: tag_set,
        version_id
    });
    if (reply.version_id) res.setHeader('x-amz-version-id', reply.version_id);
}

module.exports = {
    handler: put_object_tagging,
    body: {
        type: 'xml',
    },
    reply: {
        type: 'empty',
    },
};
