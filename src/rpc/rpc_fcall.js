/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../util/promise');
const RpcBaseConnection = require('./rpc_base_conn');

class RpcFcallConnection extends RpcBaseConnection {
    _close() {
        /* noop */
    }

    _connect() {
        setImmediate(() => this.emit('connect'));
    }

    async _send(msg) {
        await P.immediate();
        this.emit('message', msg);
    }

    /**
     * @override
     */
    _encode_message(msg) {
        // A clone is needed because an RPC connection lives inside the same process.
        // If the and part of the msg content will change after the message is sent
        // both the sender and reciver will e effected by the change.
        return msg.clone();
    }

    /**
     * @override
     */
    _decode_message(msg) {
        return msg;
    }
}

module.exports = RpcFcallConnection;
