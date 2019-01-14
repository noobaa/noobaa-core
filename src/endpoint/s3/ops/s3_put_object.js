/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const s3_utils = require('../s3_utils');
const http_utils = require('../../../util/http_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectPUT.html
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectCOPY.html
 */
async function put_object(req, res) {
    // TODO: Use the sse_c_params in the future for encryption
    const sse_c_params = s3_utils.parse_sse_c(req);
    const copy_source = s3_utils.parse_copy_source(req);

    dbg.log0('PUT OBJECT', req.params.bucket, req.params.key,
        req.headers['x-amz-copy-source'] || '', sse_c_params);

    const reply = await req.object_sdk.upload_object({
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
    });
    if (reply.version_id && reply.version_id !== 'null') {
        res.setHeader('x-amz-version-id', reply.version_id);
    }
    if (copy_source) {
        // TODO: This needs to be checked regarding copy between diff namespaces
        // In that case we do not have the copy_source property and just read and upload the stream
        if (reply.copy_source && reply.copy_source.version_id) res.setHeader('x-amz-copy-source-version-id', reply.copy_source.version_id);
        return {
            CopyObjectResult: {
                // TODO S3 last modified and etag should be for the new part
                LastModified: s3_utils.format_s3_xml_date(reply.create_time),
                ETag: `"${reply.etag}"`
            }
        };
    }
    res.setHeader('ETag', `"${reply.etag}"`);
}


function get_bucket_usage(req, res) {
    // don't count usage for copy
    const write_bytes = req.headers['x-amz-copy-source'] ? 0 : s3_utils.parse_content_length(req);
    return {
        bucket: req.params.bucket,
        access_key: req.object_sdk.get_auth_token().access_key,
        write_bytes,
        write_count: 1
    };
}

module.exports = {
    handler: put_object,
    get_bucket_usage,
    body: {
        type: 'raw',
    },
    reply: {
        type: 'xml',
    },
};
