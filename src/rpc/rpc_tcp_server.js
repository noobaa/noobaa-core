/* Copyright (C) 2016 NooBaa */
'use strict';

// let _ = require('lodash');
// let P = require('../util/promise');
let net = require('net');
let tls = require('tls');
let url = require('url');
let events = require('events');
let RpcTcpConnection = require('./rpc_tcp');
let dbg = require('../util/debug_module')(__filename);

/**
 *
 * RpcTcpServer
 *
 */
class RpcTcpServer extends events.EventEmitter {

    constructor(tls_options) {
        super();
        this.protocol = (tls_options ? 'tls:' : 'tcp:');
        this.server = tls_options ?
            tls.createServer({ ...tls_options, honorCipherOrder: true }, tcp_conn => this._on_tcp_conn(tcp_conn)) :
            net.createServer(tcp_conn => this._on_tcp_conn(tcp_conn));
        this.server.on('close', err => {
            dbg.log0('on close:', err);
            // emitting this as error is not desirable since no one is listening and it gives Uncaught Error.
            // this happens on test_rpc as after each test we call disconnect. 
            // this.emit('error', new Error('TCP SERVER CLOSED'));
        });
        this.server.on('error', err => this.emit('error', err));
    }

    close() {
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
            throw new Error('TCP SERVER CLOSED');
        }
        if (this.port) {
            return this.port;
        }
        this.server.listen(preffered_port, () => {
            this.port = this.server.address().port;
            this.emit('listening', this.port);
        });
        // will wait for the listening event, but also listen for failures and reject
        return events.once(this, 'listening');
    }

    _on_tcp_conn(tcp_conn) {
        let address;
        try {
            // using url.format and then url.parse in order to handle ipv4/ipv6 correctly
            address = url.format({
                protocol: this.protocol,
                hostname: tcp_conn.remoteAddress,
                port: tcp_conn.remotePort
            });
            let addr_url = url.parse(address);
            let conn = new RpcTcpConnection(addr_url);
            dbg.log0('TCP ACCEPT CONNECTION', conn.connid + ' ' + conn.url.href);
            conn.tcp_conn = tcp_conn;
            conn._init_tcp();
            conn.emit('connect');
            this.emit('connection', conn);
        } catch (err) {
            dbg.log0('TCP ACCEPT ERROR', address, err.stack || err);
            tcp_conn.destroy();
        }
    }

}

module.exports = RpcTcpServer;
