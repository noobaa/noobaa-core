'use strict';

// let _ = require('lodash');
// let P = require('../util/promise');
let url = require('url');
let EventEmitter = require('events').EventEmitter;
let RpcNtcpConnection = require('./rpc_ntcp');
let native_core = require('../util/native_core');
let dbg = require('../util/debug_module')(__filename);

/**
 *
 * RpcNtcpServer
 *
 */
class RpcNtcpServer extends EventEmitter {

    constructor(tls_options) {
        super();
        this.protocol = (tls_options ? 'ntls:' : 'ntcp:');
        let Ntcp = native_core().Ntcp;
        this.server = new Ntcp();
        this.server.on('connection', ntcp => this._on_connection(ntcp));
        this.server.on('close', err =>
            this.emit('error', new Error('NTCP SERVER CLOSED')));
        this.server.on('error', err => this.emit('error', err));
    }

    close(err) {
        if (this.closed) return;
        this.closed = true;
        this.emit('close');
        if (this.server) {
            this.server.close();
        }
        this.port = 0;
    }

    listen(preffered_port) {
        if (!this.server) {
            throw new Error('NTCP SERVER CLOSED');
        }
        if (this.port) {
            return this.port;
        }
        this.port = this.server.listen(preffered_port, '0.0.0.0');
    }

    _on_connection(ntcp) {
        let address;
        try {
            // using url.format and then url.parse in order to handle ipv4/ipv6 correctly
            address = url.format({
                protocol: this.protocol,
                hostname: ntcp.remoteAddress,
                port: ntcp.remotePort
            });
            let addr_url = url.parse(address);
            let conn = new RpcNtcpConnection(addr_url);
            dbg.log0('NTCP ACCEPT CONNECTION', conn.connid + ' ' + conn.url.href);
            conn.ntcp = ntcp;
            conn._init_tcp();
            conn.emit('connect');
            this.emit('connection', conn);
        } catch (err) {
            dbg.log0('NTCP ACCEPT ERROR', address, err.stack || err);
            ntcp.close();
        }
    }

}

module.exports = RpcNtcpServer;
