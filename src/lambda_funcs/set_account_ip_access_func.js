/* Copyright (C) 2016 NooBaa */
'use strict';

/* sample event:
    {
        "email": "email@email.com",
        "ips": ["1.1.1.1"]
    }
*/

exports.handler = function(event, context, callback) {
    context.rpc_client.account.update_account(event)
        .then(res => callback(null, "Done"))
        .catch(err => callback(err));
};
