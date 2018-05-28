/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const BlobError = require('../blob_errors').BlobError;

/**
 * https://docs.microsoft.com/en-us/rest/api/storageservices/list-blobs
 */
function get_container_list(req, res) {
    let params = {
        bucket: req.params.bucket,
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

    let max_keys_received = Number(req.query.maxresults || 1000);
    if (!_.isInteger(max_keys_received) || max_keys_received < 0) {
        throw new BlobError(BlobError.InvalidArgument);
    }
    params.limit = Math.min(max_keys_received, 1000);

    return req.object_sdk.list_objects(params)
        .then(reply => ({
            EnumerationResults: {
                _attr: {
                    ContainerName: req.params.bucket,
                },
                _content: {
                    Prefix: req.query.prefix,
                    Marker: req.query.marker,
                    MaxResults: req.query.maxresults,
                    Delimiter: req.query.delimiter,
                    NextMarker: reply.next_marker,
                    Blobs: [
                        reply.objects.map(obj => ({
                            Blob: {
                                Name: obj.key,
                                Properties: {
                                    // ETag: `"${obj.etag}"`,
                                    ETag: obj.etag,
                                    BlobType: 'BlockBlob',
                                    LeaseStatus: 'unlocked',
                                    LeaseState: 'available',
                                    ServerEncrypted: false,
                                    'Last-Modified': (new Date(obj.create_time)).toUTCString(),
                                    'Content-Length': obj.size,
                                    'Content-Type': obj.content_type,
                                    // 'Content-Encoding': {},
                                    // 'Content-Language': {},
                                    // 'Content-MD5': {},
                                    // 'Cache-Control': {},
                                    // 'Content-Disposition': {},
                                }
                            }
                        })),
                        reply.common_prefixes.map(prefix => ({
                            BlobPrefix: {
                                Name: prefix
                            }
                        }))
                    ],
                },
            }
        }));
}

module.exports = {
    handler: get_container_list,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
