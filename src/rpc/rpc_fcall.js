/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const RpcBaseConnection = require('./rpc_base_conn');
const InMemoryRpcRequest = require('./in_memory_rpc_request');

require('setimmediate');

class RpcFcallConnection extends RpcBaseConnection {

    get RpcRequestType() {
        return InMemoryRpcRequest;
    }

    constructor(addr_url) {
        super(addr_url);
        this._close = _.noop;
        this._connect = () => setImmediate(() => this.emit('connect'));
        this._send = msg => setImmediate(() => this.emit('message', msg));
    }
}

module.exports = RpcFcallConnection;
