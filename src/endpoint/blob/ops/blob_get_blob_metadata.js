/* Copyright (C) 2016 NooBaa */
'use strict';

// const BlobError = require('../blob_errors').BlobError;
const blob_utils = require('../blob_utils');
const http_utils = require('../../../util/http_utils');

/**
 * https://docs.microsoft.com/en-us/rest/api/storageservices/get-blob-metadata
 */
function get_blob_metadata(req, res) {
    return req.object_sdk.read_object_md({
            bucket: req.params.bucket,
            key: req.params.key,
            md_conditions: http_utils.get_md_conditions(req),
        })
        .then(object_md => {
            blob_utils.set_response_object_md(res, object_md);
        });
}

module.exports = {
    handler: get_blob_metadata,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
