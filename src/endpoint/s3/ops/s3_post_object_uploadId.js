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
function post_object_uploadId(req, res) {

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

    return req.object_sdk.complete_object_upload({
            obj_id: req.query.uploadId,
            bucket: req.params.bucket,
            key: req.params.key,
            md_conditions: http_utils.get_md_conditions(req),
            multiparts
        })
        .tap(reply => {
            if (reply.version_id) {
                res.setHeader('x-amz-version-id', reply.version_id);
            }
        })
        .then(reply => ({
            CompleteMultipartUploadResult: {
                Bucket: req.params.bucket,
                Key: req.params.key,
                ETag: `"${reply.etag}"`,
                Location: req.originalUrl,
            }
        }));
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
