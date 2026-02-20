/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const S3Error = require('../s3_errors').S3Error;
const s3_utils = require('../s3_utils');
const http_utils = require('../../../util/http_utils');
const rdma_utils = require('../../../util/rdma_utils');

const s3_error_options = {
    ErrorClass: S3Error,
    error_missing_content_length: S3Error.MissingContentLength
};
/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadUploadPart.html
 * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadUploadPartCopy.html
 * @param {nb.S3Request} req
 * @param {nb.S3Response} res
 */
async function put_object_uploadId(req, res) {

    const encryption = s3_utils.parse_encryption(req);
    const num = s3_utils.parse_part_number(req.query.partNumber, S3Error.InvalidArgument);
    const copy_source = s3_utils.parse_copy_source(req);
    const rdma_info = rdma_utils.parse_rdma_info(req);

    // Copy request sends empty content and not relevant to the object data
    const { size, md5_b64, sha256_b64 } = copy_source ? {} : {
        size: http_utils.parse_content_length(req, s3_error_options),
        md5_b64: req.content_md5 && req.content_md5.toString('base64'),
        sha256_b64: req.content_sha256_buf && req.content_sha256_buf.toString('base64'),
    };

    dbg.log0('PUT OBJECT PART', req.params.bucket, req.params.key, num,
        req.headers['x-amz-copy-source'] || '');
    const source_stream = req.chunked_content ? s3_utils.decode_chunked_upload(req) : req;
    let reply;
    try {
        reply = await req.object_sdk.upload_multipart({
            obj_id: req.query.uploadId,
            bucket: req.params.bucket,
            key: req.params.key,
            num,
            copy_source,
            source_stream,
            rdma_info,
            size,
            md5_b64,
            sha256_b64,
            source_md_conditions: http_utils.get_md_conditions(req, 'x-amz-copy-source-'),
            encryption
        });
    } catch (e) {
        if (e.code === 'InvalidArgument') {
            dbg.warn('Invalid Argument');
            throw new S3Error(S3Error.InvalidArgument);
        }
        throw e;
    }
    s3_utils.set_encryption_response_headers(req, res, reply.encryption);
    rdma_utils.set_rdma_response_headers(req, res, rdma_info, reply.rdma_reply);

    // TODO: We do not return the VersionId of the object that was copied
    res.setHeader('ETag', `"${reply.etag}"`);

    if (copy_source) {
        return {
            CopyPartResult: {
                LastModified: s3_utils.format_s3_xml_date(reply.create_time),
                ETag: `"${reply.etag}"`
            }
        };
    }
}

function get_bucket_usage(req, res) {
    // don't count usage for copy
    if (req.headers['x-amz-copy-source']) return;
    return {
        bucket: req.params.bucket,
        access_key: req.object_sdk.get_auth_token().access_key,
        write_bytes: http_utils.parse_content_length(req, s3_error_options),
    };
}


module.exports = {
    handler: put_object_uploadId,
    get_bucket_usage,
    body: {
        type: 'raw',
    },
    reply: {
        type: 'xml',
    },
};
