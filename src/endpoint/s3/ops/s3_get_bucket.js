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
    let params = {
        bucket: req.params.bucket,
    };

    if (req.query['list-type'] === '2') {
        if ('continuation-token' in req.query) {
            try {
                params.key_marker = JSON.parse(Buffer.from(req.query['continuation-token'], 'base64').toString()).key;
            } catch (err) {
                throw new S3Error(S3Error.InvalidArgument);
            }
        } else if ('start-after' in req.query) {
            params.key_marker = req.query['start-after'];
        }
    } else if ('marker' in req.query) {
        params.key_marker = req.query.marker;
    }
    if ('prefix' in req.query) {
        params.prefix = req.query.prefix;
    }
    if ('delimiter' in req.query) {
        params.delimiter = req.query.delimiter;
    }

    let max_keys_received = Number(req.query['max-keys'] || 1000);
    if (!Number.isInteger(max_keys_received) || max_keys_received < 0) {
        dbg.warn('Invalid max-keys', req.query['max-keys']);
        throw new S3Error(S3Error.InvalidArgument);
    }
    params.limit = Math.min(max_keys_received, 1000);

    return req.object_sdk.list_objects(params)
        .then(reply => {
            let update_object;
            if (req.query['list-type'] === '2') {
                update_object = {
                    'Name': req.params.bucket,
                    'Prefix': req.query.prefix,
                    'Delimiter': req.query.delimiter,
                    'MaxKeys': max_keys_received,
                    'IsTruncated': reply.is_truncated,
                    'Encoding-Type': req.query['encoding-type'],
                    'ContinuationToken': req.query['continuation-token'],
                    'KeyCount': reply.objects.length,
                    'NextContinuationToken': reply.next_marker && Buffer.from(JSON.stringify({ key: reply.next_marker })).toString('base64'),
                    'StartAfter': req.query['start-after'],
                };
            } else {
                update_object = {
                    'Name': req.params.bucket,
                    'Prefix': req.query.prefix,
                    'Delimiter': req.query.delimiter,
                    'MaxKeys': max_keys_received,
                    'Marker': req.query.marker || '',
                    'IsTruncated': reply.is_truncated,
                    'NextMarker': reply.next_marker,
                    'Encoding-Type': req.query['encoding-type'],
                };
            }
            let updated_replay = {
                ListBucketResult: [
                    update_object,
                    _.map(reply.objects, obj => ({
                        Contents: {
                            Key: obj.key,
                            LastModified: s3_utils.format_s3_xml_date(obj.create_time),
                            ETag: `"${obj.etag}"`,
                            Size: obj.size,
                            Owner: (!req.query['list-type'] || req.query['fetch-owner']) && s3_utils.DEFAULT_S3_USER,
                            StorageClass: s3_utils.STORAGE_CLASS_STANDARD,
                        }
                    })),
                    _.map(reply.common_prefixes, prefix => ({
                        CommonPrefixes: {
                            Prefix: prefix || ''
                        }
                    }))
                ]
            };
            return updated_replay;
        });
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
