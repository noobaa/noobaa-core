/* Copyright (C) 2016 NooBaa */
'use strict';

class FuncIO {

    invoke(rpc_client, name, event) {
        return rpc_client.func.invoke_func({
            name,
            event,
        });
    }

}

module.exports = FuncIO;
