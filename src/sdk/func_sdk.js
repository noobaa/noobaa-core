/* Copyright (C) 2016 NooBaa */
'use strict';

class FuncSDK {

    constructor(rpc_client) {
        this.rpc_client = rpc_client;
    }

    set_auth_token(auth_token) {
        this.rpc_client.options.auth_token = auth_token;
    }

    invoke_func(params) {
        console.log('invoke_func', params);
        return this.rpc_client.func.invoke_func(params);
    }

    list_funcs() {
        return this.rpc_client.func.list_funcs();
    }

    read_func(params) {
        return this.rpc_client.func.read_func(params);
    }

    create_func(params) {
        return this.rpc_client.func.create_func(params);
    }

    delete_func(params) {
        return this.rpc_client.func.delete_func(params);
    }

}

module.exports = FuncSDK;
