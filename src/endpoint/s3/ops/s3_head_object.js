/* Copyright (C) 2016 NooBaa */
'use strict';

// const S3Error = require('../s3_errors').S3Error;
const s3_utils = require('../s3_utils');
const http_utils = require('../../../util/http_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectHEAD.html
 */
function head_object(req, res) {
    const read_md_params = {
        bucket: req.params.bucket,
        key: req.params.key,
        md_conditions: http_utils.get_md_conditions(req),
    };
    if ('versionId' in req.query) {
        read_md_params.version_id = req.query.versionId === 'null' ? null : req.query.versionId;
    }
    return req.object_sdk.read_object_md(read_md_params)
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
