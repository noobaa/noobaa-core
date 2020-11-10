/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const dbg = require('../../../util/debug_module')(__filename);
const S3Error = require('../s3_errors').S3Error;
const s3_utils = require('../s3_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadListParts.html
 * AKA List Multipart Upload Parts
 */
async function get_object_uploadId(req) {
    const max = Number(req.query['max-parts'] || 1000);
    if (!Number.isInteger(max) || max < 0) {
        dbg.warn('Invalid max-parts', req.query['max-parts']);
        throw new S3Error(S3Error.InvalidArgument);
    }

    const num_marker = Number(req.query['part-number-marker'] || 0);
    if (!Number.isInteger(num_marker)) {
        dbg.warn('Invalid part-number-marker', req.query['part-number-marker']);
        throw new S3Error(S3Error.InvalidArgument);
    }

    const reply = await req.object_sdk.list_multiparts({
        obj_id: req.query.uploadId,
        bucket: req.params.bucket,
        key: req.params.key,
        max: Math.min(max, 1000),
        num_marker,
    });
    return {
        ListPartsResult: [{
                Bucket: req.params.bucket,
                Key: req.params.key,
                UploadId: req.query.uploadId,
                Initiator: s3_utils.DEFAULT_S3_USER,
                Owner: s3_utils.DEFAULT_S3_USER,
                StorageClass: s3_utils.STORAGE_CLASS_STANDARD,
                MaxParts: max,
                PartNumberMarker: num_marker,
                IsTruncated: reply.is_truncated,
                NextPartNumberMarker: reply.next_num_marker,
            },
            _.map(reply.multiparts, part => ({
                Part: {
                    PartNumber: part.num,
                    Size: part.size,
                    ETag: `"${part.etag}"`,
                    LastModified: s3_utils.format_s3_xml_date(part.last_modified),
                }
            }))
        ]
    };
}

module.exports = {
    handler: get_object_uploadId,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
