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

var KEEPALIVE_OP = 'keepalive';
var KEEPALIVE_COMMAND = JSON.stringify({
    op: KEEPALIVE_OP
});

/**
 *
 * connect
 *
 */
RpcWsConnection.prototype.connect = function() {
    var self = this;
    if (self.ws) {
        return self.connect_defer.promise;
    }
    var ws = new WS(self.url.href);
    ws.binaryType = 'arraybuffer';
    self._init(ws);
    ws.onopen = function() {
        self._on_open();
    };
    return self.connect_defer.promise;
};


/**
 *
 * close
 *
 */
RpcWsConnection.prototype.close = function() {

    this.closed = true;
    this.emit('close');

    var ws = this.ws;
    if (!ws) {
        return;
    }


    if (ws.keepalive_interval) {
        clearInterval(ws.keepalive_interval);
        ws.keepalive_interval = null;
    }

    if (this.connect_defer) {
        this.connect_defer.reject('WS DISCONNECTED ' + this.connid);
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
RpcWsConnection.prototype.send = function(msg) {
    if (!this.ws || this.closed) {
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
            conn._init(ws);
            conn._on_open();
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



RpcWsConnection.prototype._on_open = function() {
    var self = this;
    var ws = self.ws;

    // start keepaliving
    ws.keepalive_interval =
        setInterval(send_command, 10000, KEEPALIVE_COMMAND);

    if (self.connect_defer) {
        self.connect_defer.resolve();
    }

    function send_command(command_string) {
        try {
            ws.send(command_string);
        } catch (err) {
            dbg.error('WS SEND COMMAND ERROR', self.connid, err.stack || err);
            self.close();
        }
    }
};


RpcWsConnection.prototype._init = function(ws) {
    var self = this;
    self.connect_defer = P.defer();
    self.ws = ws;

    ws.onclose = function() {
        dbg.warn('WS CLOSED', self.connid);
        self.close();
    };

    ws.onerror = function(err) {
        dbg.error('WS ERROR', self.connid, err.stack || err);
        self.close();
    };

    ws.onmessage = function(msg) {
        try {
            if (Buffer.isBuffer(msg.data) || msg.data instanceof ArrayBuffer) {
                handle_data_message(msg);
            } else {
                handle_command_message(msg);
            }
        } catch (err) {
            dbg.error('WS MESSAGE ERROR', self.connid, err.stack || err);
            self.close();
        }

        function handle_data_message(msg) {
            var buffer = buffer_utils.toBuffer(msg.data);
            self.emit('message', buffer);
        }

        function handle_command_message(msg) {
            var cmd = _.isString(msg.data) ? JSON.parse(msg.data) : msg.data;
            switch (cmd.op) {
                case KEEPALIVE_OP:
                    // noop
                    break;
                default:
                    throw new Error('BAD COMMAND ' + self.connid);
            }
        }
    };
};
