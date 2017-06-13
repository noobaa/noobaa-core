/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
// const S3Error = require('../s3_errors').S3Error;
const s3_utils = require('../s3_utils');
const http_utils = require('../../../util/http_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectPUT.html
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectCOPY.html
 */
function put_object(req, res) {

    const copy_source = s3_utils.parse_copy_source(req);

    dbg.log0('PUT OBJECT', req.params.bucket, req.params.key,
        req.headers['x-amz-copy-source'] || '');

    return req.object_io.upload_object({
            client: req.rpc_client,
            bucket: req.params.bucket,
            key: req.params.key,
            content_type: req.headers['content-type'],
            copy_source,
            source_stream: req,
            size: copy_source ? undefined : s3_utils.parse_content_length(req),
            md5_b64: req.content_md5 ? req.content_md5.toString('base64') : undefined,
            sha256_b64: req.content_sha256_buf ? req.content_sha256_buf.toString('base64') : undefined,
            md_conditions: http_utils.get_md_conditions(req),
            source_md_conditions: http_utils.get_md_conditions(req, 'x-amz-copy-source-'),
            xattr: s3_utils.get_request_xattr(req),
            xattr_copy: (req.headers['x-amz-metadata-directive'] === 'COPY'),
        })
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
