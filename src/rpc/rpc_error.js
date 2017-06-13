/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');


class RpcError extends Error {

    constructor(rpc_code, message, rpc_data) {
        const final_message = message || rpc_code || 'UNKNOWN RPC ERROR';
        super(final_message);
        if (!this.message) {
            // in the browser we cannot really extend Error with extends
            // since the Error ctor does not return its 'this'.
            // So we need to create a local error to get the current stack
            const err = new Error(final_message);
            this.stack = err.stack;
            this.message = err.message;
        }
        this.rpc_code = rpc_code;
        if (rpc_data) {
            this.rpc_data = rpc_data;
        }
    }

    toJSON() {
        return _.pick(this, 'message', 'rpc_code', 'rpc_data');
    }

    toString() {
        return 'RPC ERROR ' + this.rpc_code + ' ' + this.message;
    }

}

module.exports = RpcError;
