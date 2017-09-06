/* Copyright (C) 2016 NooBaa */
'use strict';

/* sample event:
    {
        "name": "lala",
        "email": "lala@noobaa.com",
        "password": "lala",
        "s3_access": false
        "allowed_buckets": ["mybucket"]
    }
*/

exports.handler = function(event, context, callback) {
    context.rpc_client.account.create_account(event)
        .then(() => context.rpc_client.account.read_account({email: event.email}))
        .then(res => callback(null, JSON.stringify(res)))
        .catch(err => callback(err));
};
