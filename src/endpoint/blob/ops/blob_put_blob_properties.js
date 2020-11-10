/* Copyright (C) 2016 NooBaa */
'use strict';

const http_utils = require('../../../util/http_utils');


/**
 * https://docs.microsoft.com/en-us/rest/api/storageservices/set-blob-properties
 */
async function put_blob_properties(req, res) {
    // TODO: implement PUT Blob Properties. for now just return success if blob exist 
    await req.object_sdk.read_object_md({
        bucket: req.params.bucket,
        key: req.params.key,
        md_conditions: http_utils.get_md_conditions(req),
    });
    res.statusCode = 200;
}

module.exports = {
    handler: put_blob_properties,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
