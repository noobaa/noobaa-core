/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const dbg = require('../../../util/debug_module')(__filename);
const S3Error = require('../s3_errors').S3Error;
const s3_utils = require('../s3_utils');
const http_utils = require('../../../util/http_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadComplete.html
 * AKA Complete Multipart Upload
 */
async function post_object_uploadId(req, res) {

    const multiparts = _.map(
        _.get(req.body, 'CompleteMultipartUpload.Part'),
        multipart => ({
            num: s3_utils.parse_part_number(multipart.PartNumber[0], S3Error.MalformedXML),
            etag: s3_utils.parse_etag(multipart.ETag[0], S3Error.MalformedXML),
        }));
    if (!multiparts.length) {
        dbg.warn('Missing multiparts', req.body);
        throw new S3Error(S3Error.MalformedXML);
    }

    http_utils.set_keep_alive_whitespace_interval(res);
    req.s3event = "ObjectCreated";
    req.s3event_op = "CompleteMultipartUpload";

    const reply = await req.object_sdk.complete_object_upload({
        obj_id: req.query.uploadId,
        bucket: req.params.bucket,
        key: req.params.key,
        md_conditions: http_utils.get_md_conditions(req),
        multiparts
    });

    // TODO: Should be refactored when coding the complete solution
    // We need to know all of these things prior to completion
    // This also leaves a gap on long versioned/encrypted uploads (failure to assign headers after responding)
    s3_utils.set_encryption_response_headers(req, res, reply.encryption);

    if (reply.version_id && reply.version_id !== 'null') {
        res.setHeader('x-amz-version-id', reply.version_id);
    }

    return {
        CompleteMultipartUploadResult: {
            Bucket: req.params.bucket,
            Key: req.params.key,
            ETag: `"${reply.etag}"`,
            Location: req.originalUrl,
        }
    };
}

function get_bucket_usage(req, res) {
    return {
        bucket: req.params.bucket,
        access_key: req.object_sdk.get_auth_token().access_key,
        write_count: 1
    };
}


module.exports = {
    handler: post_object_uploadId,
    get_bucket_usage,
    body: {
        type: 'xml',
    },
    reply: {
        type: 'xml',
    },
};
