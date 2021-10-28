/* Copyright (C) 2016 NooBaa */
'use strict';

const WS = global.WebSocket || require('ws'); // eslint-disable-line global-require

const dbg = require('../util/debug_module')(__filename);
const http_utils = require('../util/http_utils');
const RpcBaseConnection = require('./rpc_base_conn');

/**
 *
 * RpcWsConnection
 *
 */
class RpcWsConnection extends RpcBaseConnection {

    constructor(addr_url) {
        super(addr_url);
        if (WS === global.WebSocket) {
            this._init = this._init_browser;
            this._connect = this._connect_browser;
            this._send = this._send_browser;
        } else {
            this._init = this._init_node;
            this._connect = this._connect_node;
            this._send = this._send_node;
        }
    }

    _connect_node() {
        const ws = new WS(this.url.href, [], {
            // accept self signed ssl certificates
            agent: http_utils.get_unsecured_agent(this.url.href),
            perMessageDeflate: false,
        });
        ws.on('open', () => this.emit('connect'));
        this._init_node(ws);
    }

    _init_node(ws) {
        this.ws = ws;
        ws.binaryType = 'fragments';
        ws.on('error', err => this.emit('error', err));
        ws.on('close', () => this.emit('error', stackless_error('WS CLOSED')));
        ws.on('message', (fragments, flags) => this.emit('message', fragments));
    }

    async _send_node(msg) {
        const opts = {
            // fin marks the last fragment of the message
            fin: false,
            // rpc throughput with these options is ~200 MB/s (no ssl)
            binary: true,
            // masking (http://tools.ietf.org/html/rfc6455#section-10.3)
            // will randomly mask the messages on the wire.
            // this is needed for browsers that were malicious scripts
            // may send fake http messages inside the websocket
            // in order to poison intermediate proxy caches.
            // reduces rpc throughput to ~70 MB/s
            // mask: false,
            // zlib compression reduces throughput to ~15 MB/s
            compress: false,
        };
        for (let i = 0; i < msg.length; ++i) {
            opts.fin = (i + 1 === msg.length);
            this.ws.send(msg[i], opts);
        }
    }

    _connect_browser() {
        const ws = new WS(this.url.href);
        this._init_browser(ws);
        ws.onopen = () => this.emit('connect');
    }

    _init_browser(ws) {
        this.ws = ws;
        ws.binaryType = 'arraybuffer';
        ws.onerror = err => this.emit('error', err);
        ws.onclose = () => this.emit('error', stackless_error('WS CLOSED'));
        ws.onmessage = event => {
            try {
                const buffer = Buffer.from(event.data);
                this.emit('message', [buffer]);
            } catch (err) {
                dbg.error('WS MESSAGE ERROR', this.connid, err.stack || err, event.data);
                this.emit('error', err);
            }
        };
    }

    async _send_browser(msg) {
        const blob = new global.Blob(msg);
        this.ws.send(blob);
    }

    _close() {
        if (this.ws &&
            this.ws.readyState !== WS.CLOSED &&
            this.ws.readyState !== WS.CLOSING) {
            this.ws.close();
        }
    }

}

function stackless_error(msg) {
    const err = new Error(msg);
    err.stack = '';
    return err;
}

module.exports = RpcWsConnection;
