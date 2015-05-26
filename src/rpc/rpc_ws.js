'use strict';

module.exports = RpcWsConnection;

var _ = require('lodash');
var Q = require('q');
var url = require('url');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var buffer_utils = require('../util/buffer_utils');
var dbg = require('noobaa-util/debug_module')(__filename);
var WS = require('ws');

util.inherits(RpcWsConnection, EventEmitter);

/**
 *
 * RpcWsConnection
 *
 */
function RpcWsConnection(addr_url) {
    EventEmitter.call(this);
    this.url = addr_url;

    // generate connection id only used for identifying in debug prints
    var t = Date.now();
    this.connid = 'WS-' + t.toString(36);
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
    var ws = self.ws;
    if (ws) {
        if (self.connect_defer) {
            return self.connect_defer.promise;
        }
        if (self.closed) {
            throw new Error('WS DISCONNECTED ' + self.connid + ' ' + self.url.href);
        }
        return;
    }

    ws = new WS(self.url.href);
    self.connect_defer = Q.defer();
    ws.binaryType = 'arraybuffer';
    self.ws = ws;
    self._init();

    ws.onopen = this._on_open.bind(this);

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
        this.connect_defer.reject('WS DISCONNECTED ' + this.connid + ' ' + this.url.href);
        this.connect_defer = null;
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
        throw new Error('WS NOT OPEN ' + this.connid + ' ' + this.url.href);
    }
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
            // TODO how to find out if ws is secure and use wss:// address instead
            var address = 'ws://' + ws._socket.remoteAddress + ':' + ws._socket.remotePort;
            var addr_url = url.parse(address);
            conn = new RpcWsConnection(addr_url);
            dbg.log0('WS ACCEPT CONNECTION', conn.connid + ' ' + conn.url.href);
            conn.ws = ws;
            conn._init();
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
        self.connect_defer = null;
    }

    function send_command(command_string) {
        try {
            ws.send(command_string);
        } catch (err) {
            dbg.error('WS SEND COMMAND ERROR', self.connid, self.url.href, err.stack || err);
            self.close();
        }
    }
};


RpcWsConnection.prototype._init = function() {
    var self = this;
    var ws = self.ws;

    ws.onclose = function() {
        dbg.warn('WS CLOSED', self.connid, self.url.href);
        self.close();
    };

    ws.onerror = function(err) {
        dbg.error('WS ERROR', self.connid, self.url.href, err.stack || err);
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
            dbg.error('WS MESSAGE ERROR', self.connid, self.url.href, err.stack || err);
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
                    throw new Error('BAD COMMAND ' + self.connid + ' ' + self.url.href);
            }
        }
    };
};
