/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const dbg = require('../../../util/debug_module')(__filename);

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/multiobjectdeleteapi.html
 * AKA "Multi Object Delete"
 */
function post_bucket_delete(req) {
    let keys = _.map(req.body.Delete.Object, obj => obj.Key[0]);
    dbg.log3('post_bucket_delete: keys', keys);
    return req.rpc_client.object.delete_multiple_objects({
            bucket: req.params.bucket,
            keys: keys
        })
        .then(reply => ({
            DeleteResult: [
                _.map(keys, key => ({
                    Deleted: {
                        Key: key,
                    }
                }))
            ]
        }));
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
