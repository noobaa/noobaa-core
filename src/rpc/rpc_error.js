'use strict';

const _ = require('lodash');


class RpcError extends Error {

    constructor(rpc_code, message, retryable) {
        super(message || rpc_code || 'UNKNOWN RPC ERROR');
        this.rpc_code = rpc_code;
        if (retryable) {
            this.retryable = true;
        }
    }

    toJSON() {
        return _.pick(this, 'message', 'rpc_code', 'retryable');
    }

    toString() {
        return 'RPC ERROR ' + this.rpc_code + ' ' + this.message;
    }

}

module.exports = RpcError;
