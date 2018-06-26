/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const dbg = require('../../../util/debug_module')(__filename);
const S3Error = require('../s3_errors').S3Error;
const s3_utils = require('../s3_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETVersion.html
 */
async function get_bucket_versions(req) {
    // TODO Implement support for encoding-type

    const max_keys_received = Number(req.query['max-keys'] || 1000);
    if (!Number.isInteger(max_keys_received) || max_keys_received < 0) {
        dbg.warn('Invalid max-keys', req.query['max-keys']);
        throw new S3Error(S3Error.InvalidArgument);
    }

    const reply = await req.object_sdk.list_object_versions({
        bucket: req.params.bucket,
        prefix: req.query.prefix,
        delimiter: req.query.delimiter,
        key_marker: req.query['key-marker'],
        version_id_marker: req.query['version-id-marker'],
        limit: Math.min(max_keys_received, 1000),
    });

    return {
        ListVersionsResult: [{
                'Name': req.params.bucket,
                'Prefix': req.query.prefix,
                'Delimiter': req.query.delimiter,
                'MaxKeys': max_keys_received,
                'KeyMarker': req.query['key-marker'],
                'VersionIdMarker': req.query['version-id-marker'],
                'IsTruncated': reply.is_truncated,
                'NextKeyMarker': reply.next_marker,
                'NextVersionIdMarker': reply.next_version_id_marker,
                'Encoding-Type': req.query['encoding-type'],
            },
            _.map(reply.objects, obj => (obj.delete_marker ? ({
                DeleteMarker: {
                    Key: obj.key,
                    VersionId: obj.version_id || 'null',
                    IsLatest: obj.is_latest,
                    LastModified: s3_utils.format_s3_xml_date(obj.create_time),
                    Owner: s3_utils.DEFAULT_S3_USER,
                }
            }) : ({
                Version: {
                    Key: obj.key,
                    VersionId: obj.version_id || 'null',
                    IsLatest: obj.is_latest,
                    LastModified: s3_utils.format_s3_xml_date(obj.create_time),
                    ETag: `"${obj.etag}"`,
                    Size: obj.size,
                    Owner: s3_utils.DEFAULT_S3_USER,
                    StorageClass: s3_utils.STORAGE_CLASS_STANDARD,
                }
            }))),
            _.map(reply.common_prefixes, prefix => ({
                CommonPrefixes: {
                    Prefix: prefix || ''
                }
            }))
        ]
    };
}

module.exports = {
    handler: get_bucket_versions,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
