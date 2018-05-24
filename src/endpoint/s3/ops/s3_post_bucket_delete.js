/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const dbg = require('../../../util/debug_module')(__filename);

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/multiobjectdeleteapi.html
 * AKA "Multi Object Delete"
 */
function post_bucket_delete(req) {
    const objects = _.map(req.body.Delete.Object, obj =>
        (compact({ key: obj.Key && obj.Key[0], version_id: obj.VersionId && (obj.VersionId[0] === 'null' ? null : obj.VersionId[0]) })));
    dbg.log3('post_bucket_delete: objects', objects);
    return req.object_sdk.delete_multiple_objects({
            bucket: req.params.bucket,
            objects
        })
        .then(reply => {
            const succeeded_delete = _.filter(reply, obj => !obj.code);
            const failed_delete = _.filter(reply, obj => obj.code);
            return {
                DeleteResult: [
                    _.map(succeeded_delete, obj => (compact({
                        Deleted: {
                            Key: obj.key,
                            VersionId: obj.is_null_version ? 'null' : obj.version_id,
                            DeleteMarker: obj.delete_marker,
                            DeleteMarkerVersionId: obj.delete_marker_version_id,
                        }
                    }))),
                    _.map(failed_delete, obj => (compact({
                        Error: {
                            Key: obj.key,
                            VersionId: obj.is_null_version ? 'null' : obj.version_id,
                            Code: obj.code,
                            Message: obj.message,
                        }
                    }))),
                ]
            };
        });
}

function compact(obj) {
    return _.omitBy(obj, _.isUndefined);
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
