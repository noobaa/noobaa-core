/* Copyright (C) 2016 NooBaa */
'use strict';

class LambdaIO {

    invoke(rpc_client, name, event) {
        return rpc_client.lambda.invoke_func({
            name,
            event,
        });
    }

}

module.exports = LambdaIO;
