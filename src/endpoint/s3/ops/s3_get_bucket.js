/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const dbg = require('../../../util/debug_module')(__filename);
const S3Error = require('../s3_errors').S3Error;
const s3_utils = require('../s3_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGET.html
 */
async function get_bucket(req) {

    const max_keys_received = Number(req.query['max-keys'] || 1000);
    if (!Number.isInteger(max_keys_received) || max_keys_received < 0) {
        dbg.warn('Invalid max-keys', req.query['max-keys']);
        throw new S3Error(S3Error.InvalidArgument);
    }

    const list_type = req.query['list-type'];
    const cont_tok = req.query['continuation-token'];
    const start_after = req.query['start-after'];

    let params = {
        bucket: req.params.bucket,
        prefix: req.query.prefix,
        delimiter: req.query.delimiter,
        limit: Math.min(max_keys_received, 1000),
        key_marker: list_type === '2' ?
            (cont_tok_to_key_marker(cont_tok) || start_after) : req.query.marker,
    };

    if (req.query.get_from_cache) {
        params.get_from_cache = req.query.get_from_cache;
    }
    const reply = await req.object_sdk.list_objects(params);

    let res_params = {
        'Name': req.params.bucket,
        'Prefix': req.query.prefix,
        'MaxKeys': max_keys_received,
        'IsTruncated': reply.is_truncated,
        'Encoding-Type': req.query['encoding-type'],
    };
    if (req.query.delimiter !== '') {
        res_params.Delimiter = req.query.delimiter;
    }
    // Always have last_modified_time take precedence. This time is set only for cached objects.
    // Non cached objects will always default to obj.create_time
    return {
        ListBucketResult: [res_params, list_type === '2' ? {
                'ContinuationToken': cont_tok,
                'StartAfter': start_after,
                'KeyCount': reply.objects.length,
                'NextContinuationToken': key_marker_to_cont_tok(reply.next_marker),
            } : { // list_type v1
                'Marker': req.query.marker || '',
                'NextMarker': reply.next_marker,
            },
            _.map(reply.objects, obj => ({
                Contents: {
                    Key: obj.key,
                    // if the object specifies last_modified_time we use it, otherwise take create_time.
                    LastModified: s3_utils.format_s3_xml_date(obj.last_modified_time || obj.create_time),
                    ETag: `"${obj.etag}"`,
                    Size: obj.size,
                    Owner: (!list_type || req.query['fetch-owner']) && s3_utils.DEFAULT_S3_USER,
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
}

function cont_tok_to_key_marker(cont_tok) {
    if (!cont_tok) return;
    try {
        const b = Buffer.from(cont_tok, 'base64');
        const j = JSON.parse(b);
        return j.key;
    } catch (err) {
        throw new S3Error(S3Error.InvalidArgument);
    }
}

function key_marker_to_cont_tok(key_marker) {
    if (!key_marker) return;
    const j = JSON.stringify({ key: key_marker });
    return Buffer.from(j).toString('base64');
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
