/* Copyright (C) 2016 NooBaa */
'use strict';

const s3_utils = require('../s3_utils');
const http_utils = require('../../../util/http_utils');
const S3Error = require('../s3_errors').S3Error;

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectHEAD.html
 */
async function head_object(req, res) {
    const encryption = s3_utils.parse_encryption(req);
    const params = {
        bucket: req.params.bucket,
        key: req.params.key,
        version_id: req.query.versionId,
        md_conditions: http_utils.get_md_conditions(req),
        encryption
    };
    if (req.query.partNumber) {
        params.multipart_number = s3_utils.parse_part_number(req.query.partNumber, S3Error.InvalidArgument);
    }
    if (req.query.get_from_cache !== undefined) {
        params.get_from_cache = true;
    }
    const object_md = await req.object_sdk.read_object_md(params);
    const obj_size = object_md.size;

    s3_utils.set_response_object_md(res, object_md);
    s3_utils.set_encryption_response_headers(req, res, object_md.encryption);
    s3_utils.set_response_range(req, res, object_md, obj_size);
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
