/* Copyright (C) 2016 NooBaa */
'use strict';

// const BlobError = require('../blob_errors').BlobError;
const blob_utils = require('../blob_utils');
const time_utils = require('../../../util/time_utils');

/**
 * https://docs.microsoft.com/en-us/rest/api/storageservices/get-container-metadata
 */
function get_container_metadata(req, res) {
    return req.object_sdk.read_bucket({ name: req.params.bucket })
        .then(bucket_info => {
            res.setHeader('ETag', `"${req.params.bucket}"`);
            res.setHeader('Last-Modified', time_utils.format_http_header_date(new Date()));
            blob_utils.set_response_xattr(res, bucket_info.xattr);
        });
}

module.exports = {
    handler: get_container_metadata,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
