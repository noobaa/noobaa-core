/* Copyright (C) 2016 NooBaa */
'use strict';

class FuncIO {

    invoke({
        rpc_client,
        name,
        version,
        event,
    }) {
        console.log('invoke_func', name, event);
        return rpc_client.func.invoke_func({
            name,
            version,
            event,
        });
    }

}

module.exports = FuncIO;
