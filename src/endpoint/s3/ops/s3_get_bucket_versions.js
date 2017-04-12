/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const dbg = require('../../../util/debug_module')(__filename);
const S3Error = require('../s3_errors').S3Error;
const s3_utils = require('../s3_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETVersion.html
 */
function get_bucket_versions(req) {
    // TODO S3 MUST implement KeyMarker & VersionIdMarker & MaxKeys & IsTruncated
    let params = {
        bucket: req.params.bucket,
        upload_mode: false,
    };
    if ('prefix' in req.query) {
        params.prefix = req.query.prefix;
    }
    if ('delimiter' in req.query) {
        params.delimiter = req.query.delimiter;
    }
    if ('key-marker' in req.query) {
        params.key_marker = req.query['key-marker'];
    }

    let max_keys_received = Number(req.query['max-keys'] || 1000);
    if (!Number.isInteger(max_keys_received) || max_keys_received < 0) {
        dbg.warn('Invalid max-keys', req.query['max-keys']);
        throw new S3Error(S3Error.InvalidArgument);
    }
    params.limit = Math.min(max_keys_received, 1000);

    return req.rpc_client.object.list_objects_s3(params)
        .then(reply => ({
            ListVersionsResult: [{
                    'Name': req.params.bucket,
                    'Prefix': req.query.prefix,
                    'Delimiter': req.query.delimiter,
                    'MaxKeys': max_keys_received,
                    'KeyMarker': req.query['key-marker'],
                    'VersionIdMarker': req.query['version-id-marker'],
                    'IsTruncated': reply.is_truncated,
                    'NextKeyMarker': reply.next_marker,
                    // 'NextVersionIdMarker': ...
                    'Encoding-Type': req.query['encoding-type'],
                },
                _.map(reply.objects, obj => ({
                    Version: {
                        Key: obj.key,
                        VersionId: '',
                        IsLatest: true,
                        LastModified: s3_utils.format_s3_xml_date(obj.info.create_time),
                        ETag: `"${obj.info.etag}"`,
                        Size: obj.info.size,
                        Owner: s3_utils.DEFAULT_S3_USER,
                        StorageClass: s3_utils.STORAGE_CLASS_STANDARD,
                    }
                })),
                _.map(reply.common_prefixes, prefix => ({
                    CommonPrefixes: {
                        Prefix: prefix || ''
                    }
                }))
            ]
        }));
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
