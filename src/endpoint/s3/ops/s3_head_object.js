/* Copyright (C) 2016 NooBaa */
'use strict';

// const S3Error = require('../s3_errors').S3Error;
const s3_utils = require('../s3_utils');
const http_utils = require('../../../util/http_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectHEAD.html
 */
function head_object(req, res) {
    return req.object_sdk.read_object_md({
            bucket: req.params.bucket,
            key: req.params.key,
            md_conditions: http_utils.get_md_conditions(req),
            version_id: req.query.versionId,
        })
        .then(object_md => s3_utils.set_response_object_md(res, object_md));
}

module.exports = {
    handler: head_object,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
