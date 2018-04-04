/* Copyright (C) 2016 NooBaa */
'use strict';

/* sample event:
    {
        "name": "bucket_name"
    }
*/

exports.handler = function(event, context, callback) {
    context.rpc_client.bucket.read_bucket(event)
        .then(res => callback(null, JSON.stringify(res)))
        .catch(err => callback(err));
};
