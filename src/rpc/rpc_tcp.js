/* Copyright (C) 2016 NooBaa */
'use strict';

const net = require('net');
const tls = require('tls');

// const dbg = require('../util/debug_module')(__filename);
const config = require('../../config');
const FrameStream = require('../util/frame_stream');
const RpcBaseConnection = require('./rpc_base_conn');

const TCP_FRAME_CONFIG = {
    magic: 'TCPmagic',
    max_len: config.MAX_OBJECT_PART_SIZE,
};


/**
 *
 * RpcTcpConnection
 *
 */
class RpcTcpConnection extends RpcBaseConnection {

    // constructor(addr_url) { super(addr_url); }

    /**
     *
     * connect
     *
     */
    _connect() {
        if (this.url.protocol === 'tls:') {
            this.tcp_conn = tls.connect({
                port: this.url.port,
                host: this.url.hostname,
                // we allow self generated certificates to avoid public CA signing:
                rejectUnauthorized: false,
            }, () => this.emit('connect'));
        } else {
            this.tcp_conn = net.connect({
                port: this.url.port,
                host: this.url.hostname,
            }, () => this.emit('connect'));
        }
        this._init_tcp();
    }

    /**
     *
     * close
     *
     */
    _close() {
        if (this.tcp_conn) {
            this.tcp_conn.destroy();
        }
    }

    /**
     *
     * send
     *
     */
    async _send(msg) {
        return this.frame_stream.send_message(msg);
    }

    _init_tcp() {
        let tcp_conn = this.tcp_conn;

        tcp_conn.on('close', () => {
            let closed_err = new Error('TCP CLOSED');
            closed_err.stack = '';
            this.emit('error', closed_err);
        });

        tcp_conn.on('error', err => this.emit('error', err));

        tcp_conn.on('timeout', () => {
            let timeout_err = new Error('TCP IDLE TIMEOUT');
            timeout_err.stack = '';
            this.emit('error', timeout_err);
        });

        // FrameStream reads data from the socket and emit framed messages
        this.frame_stream = new FrameStream(
            tcp_conn,
            msg => this.emit('message', msg),
            TCP_FRAME_CONFIG);
    }

}

module.exports = RpcTcpConnection;
