'use strict';

let _ = require('lodash');
// let P = require('../util/promise');
let RpcBaseConnection = require('./rpc_base_conn');
let buffer_utils = require('../util/buffer_utils');
let dbg = require('../util/debug_module')(__filename);
let WS = require('ws');

let WS_CONNECT_OPTIONS = {
    // accept self signed ssl certificates
    rejectUnauthorized: false
};

let WS_SEND_OPTIONS = {
    // rpc throughput with these options is ~200 MB/s (no ssl)
    binary: true,
    // masking (http://tools.ietf.org/html/rfc6455#section-10.3)
    // will randomly mask the messages on the wire.
    // this is needed for browsers that were malicious scripts
    // may send fake http messages inside the websocket
    // in order to poison intermediate proxy caches.
    // reduces rpc throughput to ~70 MB/s
    mask: false,
    // zlib compression reduces throughput to ~15 MB/s
    compress: false
};

/**
 *
 * RpcWsConnection
 *
 */
class RpcWsConnection extends RpcBaseConnection {

    // constructor(addr_url) { super(addr_url); }

    _connect() {
        let ws = new WS(this.url.href, null, WS_CONNECT_OPTIONS);
        this._init_ws(ws);
        ws.onopen = () => this.emit('connect');
    }

    _close() {
        close_ws(this.ws);
    }

    _send(msg) {
        msg = _.isArray(msg) ? Buffer.concat(msg) : msg;
        this.ws.send(msg, WS_SEND_OPTIONS);
    }

    _init_ws(ws) {
        this.ws = ws;
        ws.binaryType = 'arraybuffer';

        ws.onclose = () => {
            let closed_err = new Error('WS CLOSED');
            closed_err.stack = '';
            this.emit('error', closed_err);
        };

        ws.onerror = err => this.emit('error', err);

        ws.onmessage = msg => {
            try {
                let buffer = buffer_utils.toBuffer(msg.data);
                this.emit('message', buffer);
            } catch (err) {
                dbg.error('WS MESSAGE ERROR', this.connid, err.stack || err);
                this.emit('error', err);
            }
        };
    }

}

function close_ws(ws) {
    if (ws &&
        ws.readyState !== WS.CLOSED &&
        ws.readyState !== WS.CLOSING) {
        ws.close();
    }
}


module.exports = RpcWsConnection;
