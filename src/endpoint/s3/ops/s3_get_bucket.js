/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const dbg = require('../../../util/debug_module')(__filename);
const S3Error = require('../s3_errors').S3Error;
const s3_utils = require('../s3_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGET.html
 */
function get_bucket(req) {
    if (req.query['list-type'] === '2') {
        throw new S3Error(S3Error.NotImplemented);
    }
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
    if ('marker' in req.query) {
        params.key_marker = req.query.marker;
    }

    let max_keys_received = Number(req.query['max-keys'] || 1000);
    if (!Number.isInteger(max_keys_received) || max_keys_received < 0) {
        dbg.warn('Invalid max-keys', req.query['max-keys']);
        throw new S3Error(S3Error.InvalidArgument);
    }
    params.limit = Math.min(max_keys_received, 1000);

    return req.rpc_client.object.list_objects_s3(params)
        .then(reply => ({
            ListBucketResult: [{
                    'Name': req.params.bucket,
                    'Prefix': req.query.prefix,
                    'Delimiter': req.query.delimiter,
                    'MaxKeys': max_keys_received,
                    'Marker': req.query.marker || '',
                    'IsTruncated': reply.is_truncated,
                    'NextMarker': reply.next_marker,
                    'Encoding-Type': req.query['encoding-type'],
                },
                _.map(reply.objects, obj => ({
                    Contents: {
                        Key: obj.key,
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
    handler: get_bucket,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
