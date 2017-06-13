/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const S3Error = require('../s3_errors').S3Error;
const s3_utils = require('../s3_utils');
const http_utils = require('../../../util/http_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadUploadPart.html
 * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadUploadPartCopy.html
 */
function put_object_uploadId(req, res) {

    const num = s3_utils.parse_part_number(req.query.partNumber, S3Error.InvalidArgument);
    const copy_source = s3_utils.parse_copy_source(req);

    dbg.log0('PUT OBJECT PART', req.params.bucket, req.params.key, num,
        req.headers['x-amz-copy-source'] || '');

    return req.object_io.upload_multipart({
            client: req.rpc_client,
            obj_id: req.query.uploadId,
            bucket: req.params.bucket,
            key: req.params.key,
            num,
            copy_source,
            source_stream: req,
            size: copy_source ? undefined : s3_utils.parse_content_length(req),
            md5_b64: req.content_md5 ? req.content_md5.toString('base64') : undefined,
            sha256_b64: req.content_sha256_buf ? req.content_sha256_buf.toString('base64') : undefined,
            source_md_conditions: http_utils.get_md_conditions(req, 'x-amz-copy-source-'),
        })
        .then(reply => {
            res.setHeader('ETag', `"${reply.etag}"`);
            if (copy_source) {
                return {
                    CopyPartResult: {
                        LastModified: s3_utils.format_s3_xml_date(reply.create_time),
                        ETag: `"${reply.etag}"`
                    }
                };
            }
        });
}

module.exports = {
    handler: put_object_uploadId,
    body: {
        type: 'raw',
    },
    reply: {
        type: 'xml',
    },
};
