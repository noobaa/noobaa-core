/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const dbg = require('../../../util/debug_module')(__filename);
const S3Error = require('../s3_errors').S3Error;
const s3_utils = require('../s3_utils');

/**
 * list objects and list objects V2:
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjects.html
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html
 *
 * note: the original documentation was in the below link:
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGET.html
 * (but anyway it is permanently redirected to list object link above)
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

    const optional_object_attributes = req.headers['x-amz-optional-object-attributes'];
    const restore_status_requested = optional_object_attributes === 'RestoreStatus';

    // Only RestoreStatus is a valid attribute for now
    if (optional_object_attributes && !restore_status_requested) {
        // S3 API fails with `InvalidArgument` and this message
        throw new S3Error({ ...S3Error.InvalidArgument, message: 'Invalid attribute name specified' });
    }


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

    const field_encoder = s3_utils.get_response_field_encoder(req);

    return {
        ListBucketResult: [{
            Name: req.params.bucket,
            Prefix: field_encoder(req.query.prefix) || '',
            Delimiter: field_encoder(req.query.delimiter) || undefined,
            MaxKeys: max_keys_received,
            IsTruncated: reply.is_truncated,
            EncodingType: req.query['encoding-type'],
            ...(list_type === '2' ? {
                ContinuationToken: cont_tok,
                StartAfter: field_encoder(start_after),
                KeyCount: reply.objects.length + reply.common_prefixes.length,
                NextContinuationToken: key_marker_to_cont_tok(
                    reply.next_marker, reply.objects, reply.is_truncated),
            } : { // list_type v1
                Marker: req.query.marker || '',
                NextMarker: req.query.delimiter ? reply.next_marker : undefined,
            }),
        },
        await Promise.all(_.map(reply.objects, async obj => ({
            Contents: {
                Key: field_encoder(obj.key),
                // if the object specifies last_modified_time we use it, otherwise take create_time.
                // last_modified_time is set only for cached objects.
                // Non cached objects will use obj.create_time
                LastModified: s3_utils.format_s3_xml_date(obj.last_modified_time || obj.create_time),
                ETag: `"${obj.etag}"`,
                Size: obj.size,
                Owner: (!list_type || req.query['fetch-owner']) && (await s3_utils.get_object_owner(obj, req.object_sdk)),
                StorageClass: s3_utils.parse_storage_class(obj.storage_class),
                RestoreStatus: get_object_restore_status(obj, restore_status_requested)
            }
        }))),
        _.map(reply.common_prefixes, prefix => ({
            CommonPrefixes: {
                Prefix: field_encoder(prefix) || ''
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

function get_object_restore_status(obj, restore_status_requested) {
    if (!restore_status_requested || !obj.restore_status) {
        return;
    }

    const restore_status = {
        IsRestoreInProgress: obj.restore_status.ongoing,
    };
    if (!obj.restore_status.ongoing && obj.restore_status.expiry_time) {
        restore_status.RestoreExpiryDate = new Date(obj.restore_status.expiry_time).toUTCString();
    }

    return restore_status;
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
