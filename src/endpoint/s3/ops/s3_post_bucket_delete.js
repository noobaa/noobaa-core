/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const dbg = require('../../../util/debug_module')(__filename);

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/multiobjectdeleteapi.html
 * AKA "Multi Object Delete"
 */
async function post_bucket_delete(req) {

    const quiet = req.body.Delete.Quiet && req.body.Delete.Quiet[0];
    const objects = _.map(req.body.Delete.Object, obj => ({
        key: obj.Key && obj.Key[0],
        version_id: obj.VersionId && obj.VersionId[0],
    }));
    dbg.log3('post_bucket_delete: objects', objects);

    const reply = await req.object_sdk.delete_multiple_objects({
        bucket: req.params.bucket,
        objects
    });

    const results = [];
    results.length = objects.length;
    for (let i = 0; i < results.length; ++i) {
        const req_obj = objects[i];
        const res_obj = reply[i];
        if (res_obj.err_code && !quiet) {
            results[i] = {
                Error: {
                    Key: req_obj.key,
                    VersionId: req_obj.version_id,
                    Code: res_obj.err_code,
                    Message: res_obj.err_message,
                }
            };
        } else if (res_obj.created_delete_marker) {
            results[i] = {
                Deleted: {
                    Key: req_obj.key,
                    VersionId: req_obj.version_id,
                    DeleteMarker: true,
                    DeleteMarkerVersionId: res_obj.created_version_id,
                }
            };
        } else if (res_obj.deleted_delete_marker) {
            results[i] = {
                Deleted: {
                    Key: req_obj.key,
                    VersionId: req_obj.version_id,
                    DeleteMarker: true,
                    DeleteMarkerVersionId: res_obj.deleted_version_id,
                }
            };
        } else {
            results[i] = {
                Deleted: {
                    Key: req_obj.key,
                    VersionId: req_obj.version_id,
                }
            };
        }
    }

    return { DeleteResult: results };
}

module.exports = {
    handler: post_bucket_delete,
    body: {
        type: 'xml',
    },
    reply: {
        type: 'xml',
    },
};
