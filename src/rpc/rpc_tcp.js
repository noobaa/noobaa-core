'use strict';

module.exports = RpcTcpConnection;

var _ = require('lodash');
var P = require('../util/promise');
var net = require('net');
var tls = require('tls');
var url = require('url');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var RpcBaseConnection = require('./rpc_base_conn');
var dbg = require('../util/debug_module')(__filename);

util.inherits(RpcTcpConnection, RpcBaseConnection);

var MSG_HEADER_LEN = 8;
var MSG_MAGIC = 0x98765432;
var MAX_MSG_LEN = 16 * 1024 * 1024;

/**
 *
 * RpcTcpConnection
 *
 */
function RpcTcpConnection(addr_url) {
    RpcBaseConnection.call(this, addr_url);
}


/**
 *
 * connect
 *
 */
RpcTcpConnection.prototype._connect = function() {
    var self = this;
    return new P(function(resolve, reject) {
        var connector = (self.url.protocol === 'tls:' ? tls : net);
        self.tcp_conn = connector.connect({
            port: self.url.port,
            host: self.url.hostname
        }, resolve);
        self._init();
    });
};


/**
 *
 * close
 *
 */
RpcTcpConnection.prototype._close = function() {
    if (this.tcp_conn) {
        this.tcp_conn.destroy();
        this.tcp_conn = null;
    }
};



/**
 *
 * send
 *
 */
RpcTcpConnection.prototype._send = function(msg) {
    if (!this.tcp_conn) {
        throw new Error('TCP NOT OPEN ' + this.connid + ' ' + this.url.href);
    }

    var msg_len = _.sum(msg, 'length');
    dbg.log2('TCP SEND', msg_len);
    if (msg_len > MAX_MSG_LEN) {
        throw new Error('TCP sent message too big' + msg_len);
    }
    var msg_header = new Buffer(MSG_HEADER_LEN);
    msg_header.writeUInt32BE(MSG_MAGIC, 0);
    msg_header.writeUInt32BE(msg_len, 4);

    // when writing to the tcp connection we ignore the return value of false
    // (that indicates that the internal buffer is full) since the data here
    // is already in memory waiting to be sent, so we don't really need
    // another level of buffering and just prefer to push it forward.
    //
    // in addition, we also don't pass a callback function to write,
    // because we prefer not to wait and will simply close the connection
    // once error is emitted.
    try {
        this.tcp_conn.write(msg_header);
        if (_.isArray(msg)) {
            for (var i = 0; i < msg.length; ++i) {
                this.tcp_conn.write(msg[i]);
            }
        } else {
            this.tcp_conn.write(msg);
        }
    } catch(err) {
        this.close(err);
        throw err;
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
        // TODO tcp connection idle timeout, need to close it?
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
                var magic = self._msg_header.readUInt32BE(0);
                if (magic !== MSG_MAGIC) {
                    self.close(new Error('TCP received magic mismatch ' + magic));
                    return;
                }
            }
            var msg_len = self._msg_header.readUInt32BE(4);
            if (msg_len > MAX_MSG_LEN) {
                self.close(new Error('TCP received message too big ' + msg_len));
                return;
            }
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
    var protocol = (tls_options ? 'tls:' : 'tcp:');

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
            // using url.format and then url.parse in order to handle ipv4/ipv6 correctly
            var address = url.format({
                protocol: protocol,
                hostname: tcp_conn.remoteAddress,
                port: tcp_conn.remotePort
            });
            var addr_url = url.parse(address);
            var conn = new RpcTcpConnection(addr_url);
            dbg.log0('TCP ACCEPT CONNECTION', conn.connid + ' ' + conn.url.href);
            conn.tcp_conn = tcp_conn;
            conn.connected_promise = P.resolve();
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
