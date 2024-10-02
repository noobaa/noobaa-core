/* Copyright (C) 2016 NooBaa */
'use strict';

const s3_utils = require('../s3_utils');
const http_utils = require('../../../util/http_utils');
const config = require('../../../../config');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectDELETE.html
 */
async function delete_object(req, res) {
    const version_id = s3_utils.parse_version_id(req.query.versionId);
    req.s3event = 'ObjectRemoved';
    const del_res = await req.object_sdk.delete_object({
        bucket: req.params.bucket,
        key: req.params.key,
        version_id,
        md_conditions: http_utils.get_md_conditions(req),
        bypass_governance: config.WORM_ENABLED ? req.headers['x-amz-bypass-governance-retention'] &&
            req.headers['x-amz-bypass-governance-retention'].toUpperCase() === 'TRUE' : undefined,
    });
    if (version_id) {
        res.setHeader('x-amz-version-id', version_id);
        if (del_res.deleted_delete_marker) {
            res.setHeader('x-amz-delete-marker', 'true');
        }
    } else if (del_res.created_delete_marker) {
        res.setHeader('x-amz-version-id', del_res.created_version_id);
        res.setHeader('x-amz-delete-marker', 'true');
        req.s3event_op = 'DeleteMarkerCreated';
    }
    res.seq = del_res.seq;
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
