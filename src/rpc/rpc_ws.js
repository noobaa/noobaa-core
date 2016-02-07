'use strict';

module.exports = RpcWsConnection;

var _ = require('lodash');
// var P = require('../util/promise');
var url = require('url');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var RpcBaseConnection = require('./rpc_base_conn');
var buffer_utils = require('../util/buffer_utils');
var dbg = require('../util/debug_module')(__filename);
var WS = require('ws');

util.inherits(RpcWsConnection, RpcBaseConnection);

var WS_CONNECT_OPTIONS = {
    // accept self signed ssl certificates
    rejectUnauthorized: false
};

var WS_SEND_OPTIONS = {
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
function RpcWsConnection(addr_url) {
    RpcBaseConnection.call(this, addr_url);
}

/**
 *
 * connect
 *
 */
RpcWsConnection.prototype._connect = function() {
    var self = this;
    var ws = new WS(self.url.href, null, WS_CONNECT_OPTIONS);
    self._init_ws(ws);
    ws.onopen = function() {
        self.emit('connect');
    };
};

/**
 *
 * close
 *
 */
RpcWsConnection.prototype._close = function() {
    close_ws(this.ws);
};

/**
 *
 * send
 *
 */
RpcWsConnection.prototype._send = function(msg) {
    msg = _.isArray(msg) ? Buffer.concat(msg) : msg;
    this.ws.send(msg, WS_SEND_OPTIONS);
};


RpcWsConnection.prototype._init_ws = function(ws) {
    var self = this;
    self.ws = ws;
    ws.binaryType = 'arraybuffer';

    ws.onclose = function onclose() {
        var closed_err = new Error('WS CLOSED');
        closed_err.stack = '';
        self.emit('error', closed_err);
    };

    ws.onerror = function onerror(err) {
        self.emit('error', err);
    };

    ws.onmessage = function onmessage(msg) {
        try {
            var buffer = buffer_utils.toBuffer(msg.data);
            self.emit('message', buffer);
        } catch (err) {
            dbg.error('WS MESSAGE ERROR', self.connid, err.stack || err);
            self.emit('error', err);
        }
    };
};


/**
 *
 * RpcWsServer
 *
 */
RpcWsConnection.Server = RpcWsServer;

util.inherits(RpcWsServer, EventEmitter);

function RpcWsServer(http_server) {
    var self = this;
    EventEmitter.call(self);

    var ws_server = new WS.Server({
        server: http_server
    });

    ws_server.on('connection', function(ws) {
        var conn;
        var address;
        try {
            // using url.format and then url.parse in order to handle ipv4/ipv6 correctly
            address = url.format({
                // TODO how to find out if ws is secure and use wss:// address instead
                protocol: 'ws:',
                slashes: true,
                hostname: ws._socket.remoteAddress,
                port: ws._socket.remotePort
            });
            var addr_url = url.parse(address);
            conn = new RpcWsConnection(addr_url);
            dbg.log0('WS ACCEPT CONNECTION', conn.connid);
            conn.emit('connect');
            conn._init_ws(ws);
            self.emit('connection', conn);
        } catch (err) {
            dbg.log0('WS ACCEPT ERROR', address, err.stack || err);
            close_ws(ws);
            if (conn) {
                conn.emit('error', err);
            }
        }
    });

    ws_server.on('error', function(err) {
        dbg.error('WS SERVER ERROR', err.stack || err);
    });
}


function close_ws(ws) {
    if (ws &&
        ws.readyState !== WS.CLOSED &&
        ws.readyState !== WS.CLOSING) {
        ws.close();
    }
}
