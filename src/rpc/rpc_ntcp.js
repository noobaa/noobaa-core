/* Copyright (C) 2016 NooBaa */
'use strict';

// const _ = require('lodash');
// const P = require('../util/promise');
const RpcBaseConnection = require('./rpc_base_conn');
const nb_native = require('../util/nb_native');
// const dbg = require('../util/debug_module')(__filename);


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
        const Ntcp = nb_native().Ntcp;
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
        const ntcp = this.ntcp;
        ntcp.on('close', () => {
            const closed_err = new Error('TCP CLOSED');
            closed_err.stack = '';
            this.emit('error', closed_err);
        });
        ntcp.on('error', err => this.emit('error', err));
        ntcp.on('message', msg => this.emit('message', [msg]));
    }

}

module.exports = RpcNtcpConnection;
