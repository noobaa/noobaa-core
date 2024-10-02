/* Copyright (C) 2023 NooBaa */
'use strict';

const s3_utils = require('../s3_utils');

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_RestoreObject.html
 */
async function post_object_restore(req, res) {
    const encryption = s3_utils.parse_encryption(req);

    const days = s3_utils.parse_restore_request_days(req);
    const params = {
        bucket: req.params.bucket,
        key: req.params.key,
        version_id: s3_utils.parse_version_id(req.query.versionId),
        days,
        encryption,
    };
    req.s3event = 'ObjectRestore';

    const restore_object_result = await req.object_sdk.restore_object(params);
    if (restore_object_result.accepted) {
        res.statusCode = 202;
        //no need to set s3event_op, it is 'Post' by default because req.method == 'Post'
    } else {
        res.statusCode = 200;
        req.s3event_op = 'Completed';
        res.restore_object_result = restore_object_result;
    }
}

module.exports = {
    handler: post_object_restore,
    body: {
        type: 'xml',
    },
    reply: {
        type: 'empty',
    },
};
