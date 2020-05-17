/* Copyright (C) 2016 NooBaa */
'use strict';

const RpcRequest = require('./rpc_request');

// Am im memory mapping request key to request data (using en empty buffer
// as key to comply to current API).
const req_data_map = new WeakMap();

class InMemoryRpcRequest extends RpcRequest {

    static encode_message(body, buffers) {
        const empty = Buffer.alloc(0);
        req_data_map.set(empty, { body, buffers });
        return [empty];
    }

    static decode_message(msg_buffers) {
        const empty = msg_buffers[0];
        const ret = req_data_map.get(empty);
        if (!ret) throw new Error('Could not find in memory request data');
        return ret;
    }
}

module.exports = InMemoryRpcRequest;
