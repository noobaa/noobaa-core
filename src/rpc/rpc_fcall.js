/* Copyright (C) 2016 NooBaa */
'use strict';

let _ = require('lodash');
let RpcBaseConnection = require('./rpc_base_conn');

require('setimmediate');

class RpcFcallConnection extends RpcBaseConnection {

    constructor(addr_url) {
        super(addr_url);
        this._close = _.noop;
        this._connect = () => setImmediate(() => this.emit('connect'));
        this._send = msg => setImmediate(() => this.emit('message', msg));
    }
}

module.exports = RpcFcallConnection;
