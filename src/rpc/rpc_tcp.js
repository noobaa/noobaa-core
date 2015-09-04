'use strict';

module.exports = RpcTcpConnection;

var _ = require('lodash');
var P = require('../util/promise');
var net = require('net');
var tls = require('tls');
var url = require('url');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var dbg = require('../util/debug_module')(__filename);

util.inherits(RpcTcpConnection, EventEmitter);

var MSG_HEADER_LEN = 4;

/**
 *
 * RpcTcpConnection
 *
 */
function RpcTcpConnection(addr_url) {
    EventEmitter.call(this);
    this.url = addr_url;

    // generate connection id only used for identifying in debug prints
    var t = Date.now();
    this.connid = 'TCP-' + t.toString(36);
}


/**
 *
 * connect
 *
 */
RpcTcpConnection.prototype.connect = function() {
    var self = this;
    if (self.tcp_conn) {
        if (self.connect_promise) {
            return self.connect_promise;
        }
        if (self.closed) {
            throw new Error('TCP DISCONNECTED ' + self.connid + ' ' + self.url.href);
        }
        return;
    }

    self.connect_promise = new P(function(resolve, reject) {
        var connector = (self.url.protocol === 'tls:' ? tls : net);
        self.tcp_conn = connector.connect({
            port: self.url.port,
            host: self.url.hostname
        }, resolve);
        self._init();
    });

    return self.connect_promise;
};


/**
 *
 * close
 *
 */
RpcTcpConnection.prototype.close = function() {
    this.closed = true;
    this.emit('close');

    if (!this.tcp_conn) {
        return;
    }

    this.tcp_conn.destroy();
};



/**
 *
 * send
 *
 */
RpcTcpConnection.prototype.send = function(msg) {
    if (!this.tcp_conn || this.closed) {
        throw new Error('TCP NOT OPEN ' + this.connid + ' ' + this.url.href);
    }

    var msg_len = _.sum(msg, 'length');
    dbg.log2('TCP SEND', msg_len);
    var msg_header = new Buffer(MSG_HEADER_LEN);
    msg_header.writeUInt32BE(msg_len, 0);
    this.tcp_conn.write(msg_header);

    if (_.isArray(msg)) {
        for (var i = 0; i < msg.length; ++i) {
            this.tcp_conn.write(msg[i]);
        }
    } else {
        this.tcp_conn.write(msg);
    }
};


RpcTcpConnection.prototype._init = function() {
    var self = this;
    var tcp_conn = self.tcp_conn;

    tcp_conn.on('close', function(err) {
        dbg.warn('TCP CLOSED', self.connid, self.url.href);
        self.close();
    });

    tcp_conn.on('error', function(err) {
        dbg.error('TCP ERROR', self.connid, self.url.href, err.stack || err);
        self.close();
    });

    tcp_conn.on('timeout', function() {
        dbg.error('TCP IDLE', self.connid, self.url.href);
        // TODO tcp connection idle timeout, close it?
        // self.close();
    });

    // we read from the socket in non-flowing mode
    // see http://nodejs.org/dist/v0.10.40/docs/api/stream.html#stream_class_stream_readable
    // this is meant to avoid unneeded memory copies when receiving data as fragments,
    // however it might still happen that the underlying nodejs impl will do these copies.
    // reading works by fetching a small header that contains the number of bytes in the upcoming
    // message, and then we fetch the entire message as a complete buffer.
    tcp_conn.on('readable', function() {
        while (true) {
            if (!self._msg_header) {
                self._msg_header = tcp_conn.read(MSG_HEADER_LEN);
                if (!self._msg_header) {
                    break;
                }
            }
            var msg_len = self._msg_header.readUInt32BE(0);
            var msg = tcp_conn.read(msg_len);
            if (!msg) {
                break;
            }
            self._msg_header = null;
            self.emit('message', msg);
        }
    });
};


/**
 *
 * RpcTcpServer
 *
 */
RpcTcpConnection.Server = RpcTcpServer;

util.inherits(RpcTcpServer, EventEmitter);

function RpcTcpServer(port, tls_options) {
    var self = this;
    EventEmitter.call(self);
    var proto_prefix = (tls_options ? 'tls://' : 'tcp://');

    self.server = tls_options ?
        tls.createServer(tls_options, conn_handler) :
        net.createServer(conn_handler);

    self.server.on('error', function(err) {
        dbg.error('TCP SERVER ERROR', err.stack || err);
        self.server.close();
    });

    self.server.listen(port, function() {
        self.port = self.server.address().port;
    });

    function conn_handler(tcp_conn) {
        try {
            var address = proto_prefix + tcp_conn.remoteAddress + ':' + tcp_conn.remotePort;
            var addr_url = url.parse(address);
            var conn = new RpcTcpConnection(addr_url);
            dbg.log0('TCP ACCEPT CONNECTION', conn.connid + ' ' + conn.url.href);
            conn.tcp_conn = tcp_conn;
            conn._init();
            self.emit('connection', conn);
        } catch (err) {
            dbg.log0('TCP ACCEPT ERROR', address, err.stack || err);
            tcp_conn.destroy();
        }
    }
}

RpcTcpServer.prototype.close = function() {
    this.server.close();
};
