/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
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
    try {
        // A 'ranged' GET/HEAD is performed if a  "part number"
        // is specified in the S3 query or alternatively,
        // ranges could be specified in HTTP header
        const range = s3_utils.get_object_range(req, object_md);

        // If range is specified, set it in the HTTP response headers
        if (range) s3_utils.set_range_response_headers(req, res, range, obj_size);
    } catch (err) {
        if (err.ranges_code === 400) {
            // return http 400 Bad Request
            dbg.log1('bad range request', req.headers.range, req.path, obj_size);
            throw new S3Error(S3Error.InvalidArgument);
        }
        if (err.ranges_code === 416) {
            // return http 416 Requested Range Not Satisfiable
            dbg.warn('invalid range', req.headers.range, req.path, obj_size);
            // let the client know of the relevant range
            res.setHeader('Content-Range', 'bytes */' + obj_size);
            throw new S3Error(S3Error.InvalidRange);
        }
        throw err;
    }
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
