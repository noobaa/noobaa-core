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
    const encryption = s3_utils.parse_encryption(req);
    const copy_source = s3_utils.parse_copy_source(req);
    const tagging = s3_utils.parse_tagging_header(req);

    // Copy request sends empty content and not relevant to the object data
    const { size, md5_b64, sha256_b64 } = copy_source ? {} : {
        size: s3_utils.parse_content_length(req),
        md5_b64: req.content_md5 && req.content_md5.toString('base64'),
        sha256_b64: req.content_sha256_buf && req.content_sha256_buf.toString('base64'),
    };

    dbg.log0('PUT OBJECT', req.params.bucket, req.params.key,
        req.headers['x-amz-copy-source'] || '', encryption || '');

    const reply = await req.object_sdk.upload_object({
        bucket: req.params.bucket,
        key: req.params.key,
        content_type: req.headers['content-type'],
        chunked_content: req.chunked_content,
        copy_source,
        source_stream: req,
        size,
        md5_b64,
        sha256_b64,
        md_conditions: http_utils.get_md_conditions(req),
        source_md_conditions: http_utils.get_md_conditions(req, 'x-amz-copy-source-'),
        xattr: s3_utils.get_request_xattr(req),
        xattr_copy: (req.headers['x-amz-metadata-directive'] === 'COPY'),
        tagging,
        tagging_copy: s3_utils.is_copy_tagging_directive(req),
        encryption
    });

    if (reply.version_id && reply.version_id !== 'null') {
        res.setHeader('x-amz-version-id', reply.version_id);
    }

    s3_utils.set_encryption_response_headers(req, res, reply.encryption);

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
