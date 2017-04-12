/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
// const S3Error = require('../s3_errors').S3Error;
const s3_utils = require('../s3_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectPUT.html
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectCOPY.html
 */
function put_object(req, res) {

    const copy_source = s3_utils.parse_copy_source(req);

    dbg.log0('PUT OBJECT', req.params.bucket, req.params.key,
        req.headers['x-amz-copy-source'] || '');

    const params = {
        client: req.rpc_client,
        bucket: req.params.bucket,
        key: req.params.key,
        content_type: req.headers['content-type'],
        xattr: s3_utils.get_request_xattr(req),
        copy_source,
        source_stream: req,
    };

    if (copy_source) {
        params.xattr_copy = (req.headers['x-amz-metadata-directive'] === 'COPY');
        s3_utils.set_md_conditions(req, params, 'source_if', 'x-amz-copy-source-');
    } else {
        params.size = s3_utils.parse_content_length(req);
        if (req.content_md5) params.md5_b64 = req.content_md5.toString('base64');
        if (req.content_sha256) params.sha256_b64 = req.content_sha256.toString('base64');
    }
    s3_utils.set_md_conditions(req, params, 'overwrite_if');

    return req.object_io.upload_object(params)
        .then(reply => {
            if (copy_source) {
                return {
                    CopyObjectResult: {
                        // TODO S3 last modified and etag should be for the new part
                        LastModified: s3_utils.format_s3_xml_date(reply.create_time),
                        ETag: `"${reply.etag}"`
                    }
                };
            }
            res.setHeader('ETag', `"${reply.etag}"`);
        });
}

module.exports = {
    handler: put_object,
    body: {
        type: 'raw',
    },
    reply: {
        type: 'xml',
    },
};
