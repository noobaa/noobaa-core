/* Copyright (C) 2016 NooBaa */
'use strict';

const s3_utils = require('../s3_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectDELETE.html
 */
function delete_object(req) {
    const params = {
        bucket: req.params.bucket,
        key: req.params.key,
    };
    s3_utils.set_md_conditions(req, params, 'delete_if');
    return req.rpc_client.object.delete_object(params);
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
