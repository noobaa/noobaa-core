'use strict';

module.exports = RpcWsConnection;

var _ = require('lodash');
var P = require('../util/promise');
var url = require('url');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var RpcBaseConnection = require('./rpc_base_conn');
var buffer_utils = require('../util/buffer_utils');
var dbg = require('../util/debug_module')(__filename);
var WS = require('ws');

util.inherits(RpcWsConnection, RpcBaseConnection);

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
    return new P(function(resolve, reject) {
        var ws = new WS(self.url.href);
        self._init(ws);
        ws.onopen = function() {
            self.removeListener('close', reject);
            resolve();
        };
    });
};


/**
 *
 * close
 *
 */
RpcWsConnection.prototype._close = function() {
    var ws = this.ws;
    if (!ws) {
        return;
    }

    if (ws.readyState !== WS.CLOSED &&
        ws.readyState !== WS.CLOSING) {
        ws.close();
    }
};


var WS_SEND_OPTIONS = {
    binary: true,
    mask: false,
    compress: false
};


/**
 *
 * send
 *
 */
RpcWsConnection.prototype._send = function(msg) {
    if (!this.ws) {
        throw new Error('WS NOT OPEN ' + this.connid);
    }
    msg = _.isArray(msg) ? Buffer.concat(msg) : msg;
    this.ws.send(msg, WS_SEND_OPTIONS);
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
        try {
            // using url.format and then url.parse in order to handle ipv4/ipv6 correctly
            var address = url.format({
                // TODO how to find out if ws is secure and use wss:// address instead
                protocol: 'ws:',
                slashes: true,
                hostname: ws._socket.remoteAddress,
                port: ws._socket.remotePort
            });
            var addr_url = url.parse(address);
            conn = new RpcWsConnection(addr_url);
            dbg.log0('WS ACCEPT CONNECTION', conn.connid);
            conn.connected_promise = P.resolve();
            conn._init(ws);
            self.emit('connection', conn);
        } catch (err) {
            dbg.log0('WS ACCEPT ERROR', address, err.stack || err);
            if (conn) {
                conn.close();
            } else {
                ws.close();
            }
        }
    });

    ws_server.on('error', function(err) {
        dbg.error('WS SERVER ERROR', err.stack || err);
    });
}


RpcWsConnection.prototype._init = function(ws) {
    var self = this;
    self.ws = ws;
    ws.binaryType = 'arraybuffer';

    ws.onclose = function onclose() {
        dbg.warn('WS CLOSED', self.connid);
        self.close();
    };

    ws.onerror = function onerror(err) {
        dbg.error('WS ERROR', self.connid, err.stack || err);
        self.close();
    };

    ws.onmessage = function onmessage(msg) {
        try {
            var buffer = buffer_utils.toBuffer(msg.data);
            self.emit('message', buffer);
        } catch (err) {
            dbg.error('WS MESSAGE ERROR', self.connid, err.stack || err);
            self.close();
        }
    };
};
