/* Copyright (C) 2016 NooBaa */
'use strict';

// const s3_utils = require('../s3_utils');
const http_utils = require('../../../util/http_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectDELETE.html
 */
async function delete_object(req, res) {
    const delete_md_params = {
        bucket: req.params.bucket,
        key: req.params.key,
        md_conditions: http_utils.get_md_conditions(req),
    };
    if ('versionId' in req.query) {
        delete_md_params.version_id = req.query.versionId === 'null' ? null : req.query.versionId;
    }
    const { version_id, delete_marker } = await req.object_sdk.delete_object(delete_md_params);
    if (version_id !== undefined) {
        res.setHeader('x-amz-version-id', version_id);
    }
    if (delete_marker) {
        res.setHeader('x-amz-delete-marker', delete_marker);
    }
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
