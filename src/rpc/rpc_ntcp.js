/* Copyright (C) 2016 NooBaa */
'use strict';

// let _ = require('lodash');
// let P = require('../util/promise');
let RpcBaseConnection = require('./rpc_base_conn');
let nb_native = require('../util/nb_native');
// let dbg = require('../util/debug_module')(__filename);


/**
 *
 * RpcNtcpConnection
 *
 */
class RpcNtcpConnection extends RpcBaseConnection {

    // constructor(addr_url) { super(addr_url); }

    /**
     *
     * connect
     *
     */
    _connect() {
        let Ntcp = nb_native().Ntcp;
        this.ntcp = new Ntcp();
        this.ntcp.connect(this.url.port, this.url.hostname,
            () => this.emit('connect'));
        this._init_tcp();
    }

    /**
     *
     * close
     *
     */
    _close() {
        if (this.ntcp) {
            this.ntcp.close();
        }
    }

    /**
     *
     * send
     *
     */
    async _send(msg) {
        this.ntcp.write(msg);
    }

    _init_tcp() {
        let ntcp = this.ntcp;
        ntcp.on('close', () => {
            let closed_err = new Error('TCP CLOSED');
            closed_err.stack = '';
            this.emit('error', closed_err);
        });
        ntcp.on('error', err => this.emit('error', err));
        ntcp.on('message', msg => this.emit('message', [msg]));
    }

}

module.exports = RpcNtcpConnection;
