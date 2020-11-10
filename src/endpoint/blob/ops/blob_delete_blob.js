/* Copyright (C) 2016 NooBaa */
'use strict';

// const blob_utils = require('../blob_utils');
const http_utils = require('../../../util/http_utils');

async function delete_blob(req, res) {
    await req.object_sdk.delete_object({
        bucket: req.params.bucket,
        key: req.params.key,
        md_conditions: http_utils.get_md_conditions(req),
    });
    res.statusCode = 202;
}

module.exports = {
    handler: delete_blob,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
        keep_status_code: true
    },
};
