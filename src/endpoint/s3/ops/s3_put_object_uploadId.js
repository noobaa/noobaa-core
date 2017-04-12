/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const S3Error = require('../s3_errors').S3Error;
const s3_utils = require('../s3_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadUploadPart.html
 * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadUploadPartCopy.html
 */
function put_object_uploadId(req, res) {

    const num = s3_utils.parse_part_number(req.query.partNumber, S3Error.InvalidArgument);
    const copy_source = s3_utils.parse_copy_source(req);

    dbg.log0('PUT OBJECT PART', req.params.bucket, req.params.key, num,
        req.headers['x-amz-copy-source'] || '');

    const params = {
        client: req.rpc_client,
        bucket: req.params.bucket,
        key: req.params.key,
        upload_id: req.query.uploadId,
        num,
        copy_source,
        source_stream: req,
    };

    if (copy_source) {
        s3_utils.set_md_conditions(req, params, 'source_if', 'x-amz-copy-source-');
    } else {
        params.size = s3_utils.parse_content_length(req);
        if (req.content_md5) params.md5_b64 = req.content_md5.toString('base64');
        if (req.content_sha256) params.sha256_b64 = req.content_sha256.toString('base64');
    }

    return req.object_io.upload_multipart(params)
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
