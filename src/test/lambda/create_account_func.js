/* Copyright (C) 2016 NooBaa */
'use strict';

/* sample event:
    {
        "name": "lala",
        "email": "lala@noobaa.com",
        "password": "lala",
        "s3_access": false
    }
*/

exports.handler = function(event, context, callback) {
    context.rpc_client.account.create_account(event)
        .then(res => callback(null, "ACCOUNT CREATED"))
        .catch(err => callback(err));
};
