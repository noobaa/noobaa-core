/* Copyright (C) 2016 NooBaa */
'use strict';

/* sample event:
    {
        "email": "email@email.com",
        "s3_access": true,
        "default_pool": "london",
        "allowed_buckets": ["mybucket"]
    }
*/

exports.handler = function(event, context, callback) {
    context.rpc_client.account.update_account_s3_access(event)
        .then(() => context.rpc_client.account.read_account({email: event.email}))
        .then(res => callback(null, JSON.stringify(res)))
        .catch(err => callback(err));
};
