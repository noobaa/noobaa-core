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

    const params = {
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

    return {
        ListBucketResult: [{
                Name: req.params.bucket,
                Prefix: req.query.prefix,
                Delimiter: req.query.delimiter || undefined,
                MaxKeys: max_keys_received,
                IsTruncated: reply.is_truncated,
                'Encoding-Type': req.query['encoding-type'],
                ...(list_type === '2' ? {
                    ContinuationToken: cont_tok,
                    StartAfter: start_after,
                    KeyCount: reply.objects.length + reply.common_prefixes.length,
                    NextContinuationToken: key_marker_to_cont_tok(
                        reply.next_marker, reply.objects, reply.is_truncated),
                } : { // list_type v1
                    Marker: req.query.marker || '',
                    NextMarker: req.query.delimiter ? reply.next_marker : undefined,
                }),
            },
            _.map(reply.objects, obj => ({
                Contents: {
                    Key: obj.key,
                    // if the object specifies last_modified_time we use it, otherwise take create_time.
                    // last_modified_time is set only for cached objects.
                    // Non cached objects will use obj.create_time
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
        const j = JSON.parse(b.toString());
        return j.key;
    } catch (err) {
        throw new S3Error(S3Error.InvalidArgument);
    }
}

function key_marker_to_cont_tok(key_marker, objects_arr, is_truncated) {
    if (!key_marker && !is_truncated) return;
    // next marker is the key marker we got or the key of the last item in the objects list.
    const next_marker = key_marker || objects_arr[objects_arr.length - 1].key;
    const j = JSON.stringify({ key: next_marker });
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
