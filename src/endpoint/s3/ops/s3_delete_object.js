/* Copyright (C) 2016 NooBaa */
'use strict';

// const s3_utils = require('../s3_utils');
const http_utils = require('../../../util/http_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectDELETE.html
 */
function delete_object(req) {
    return req.object_sdk.delete_object({
        bucket: req.params.bucket,
        key: req.params.key,
        md_conditions: http_utils.get_md_conditions(req),
    });
}

module.exports = {
    handler: delete_object,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
