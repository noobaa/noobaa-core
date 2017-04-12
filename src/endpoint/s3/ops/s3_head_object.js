/* Copyright (C) 2016 NooBaa */
'use strict';

// const S3Error = require('../s3_errors').S3Error;
const s3_utils = require('../s3_utils');
const time_utils = require('../../../util/time_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectHEAD.html
 */
function head_object(req, res) {
    return req.rpc_client.object.read_object_md({
            bucket: req.params.bucket,
            key: req.params.key,
        })
        .then(object_md => {
            req.object_md = object_md;
            res.setHeader('ETag', '"' + object_md.etag + '"');
            res.setHeader('Last-Modified', time_utils.format_http_header_date(new Date(object_md.create_time)));
            res.setHeader('Content-Type', object_md.content_type);
            res.setHeader('Content-Length', object_md.size);
            res.setHeader('Accept-Ranges', 'bytes');
            s3_utils.set_response_xattr(res, object_md.xattr);
            s3_utils.check_md_conditions(req, res, object_md);
        });
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
