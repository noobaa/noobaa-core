/* Copyright (C) 2016 NooBaa */
'use strict';

// const BlobError = require('../blob_errors').BlobError;
const blob_utils = require('../blob_utils');
const time_utils = require('../../../util/time_utils');

/**
 * https://docs.microsoft.com/en-us/rest/api/storageservices/get-container-properties
 */
async function get_container_properties(req, res) {
    const bucket_info = await req.object_sdk.read_bucket({ name: req.params.bucket });
    res.setHeader('ETag', `"${req.params.bucket}"`);
    res.setHeader('Last-Modified', time_utils.format_http_header_date(new Date()));
    res.setHeader('x-ms-lease-state', 'available');
    res.setHeader('x-ms-lease-status', 'unlocked');
    // res.setHeader('x-ms-lease-duration', 'infinite|fixed');
    // res.setHeader('x-ms-blob-public-access', 'container|blob');
    blob_utils.set_response_xattr(res, bucket_info.xattr);
}

module.exports = {
    handler: get_container_properties,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
