'use strict';

var _ = require('lodash');
var Q = require('q');
var util = require('util');
var dgram = require('dgram');
var crypto = require('crypto');
var dbg = require('../util/debug_module')(__filename);
var EventEmitter = require('events').EventEmitter;
var promise_utils = require('../util/promise_utils');
var UdpProtocol = require('./udp_protocol');

module.exports = UdpConnection;

util.inherits(UdpConnection, EventEmitter);
util.inherits(UdpChannel, EventEmitter);


/**
 *
 * UdpConnection
 *
 * creates udp socket and maintain a channel object (UdpChannel)
 * for each peer (identified by host/port) when requested to send/receive packets.
 *
 */
function UdpConnection(localPort) {
    this.proto = new UdpProtocol();
    this.channels = {};
    this.socket = dgram.createSocket('udp4');
    this.socket.on('message', this._onSocketMessage.bind(this));
    this.socket.bind(localPort, this._onSocketBind.bind(this));
}

UdpConnection.prototype.getChannel = function(remotePort, remoteAddr) {
    this.checkClosed();
    var key = remoteAddr + ':' + remotePort;
    var channel = this.channels[key];
    if (!channel) {
        channel = this.channels[key] = new UdpChannel(this, remotePort, remoteAddr);
        this.emit('channel', channel);
    }
    channel.checkClosed();
    return channel;
};

UdpConnection.prototype.close = function() {
    dbg.log('SOCKET close');
    this.socket.close();
    _.each(this.channels, function(channel) {
        channel.close();
    });
    this.channels = null;
    this.closed = true;
};

UdpConnection.prototype.checkClosed = function() {
    if (this.closed) {
        throw new Error('SOCKET CLOSED');
    }
};

UdpConnection.prototype._removeChannel = function(channel) {
    var key = channel.remoteAddr + ':' + channel.remotePort;
    if (this.channels && this.channels[key] === channel) {
        delete this.channels[key];
    }
};

UdpConnection.prototype._send = function(buffer, remotePort, remoteAddr) {
    dbg.log2('SOCKET send to', remoteAddr + ':' + remotePort, 'buffer', buffer.length);
    this.checkClosed();
    return Q.ninvoke(this.socket, 'send', buffer, 0, buffer.length, remotePort, remoteAddr)
        .then(immediateQ);
};

UdpConnection.prototype._onSocketMessage = function(buffer, rinfo) {
    dbg.log2('SOCKET packet from', rinfo, 'buffer', buffer.length);
    var channel = this.getChannel(rinfo.port, rinfo.address);
    this.proto.handlePacket(channel, buffer);
};

UdpConnection.prototype._onSocketBind = function() {
    dbg.log('SOCKET bind ready', this.socket.address());
    this.emit('ready');
};

function immediateQ() {
    var defer = Q.defer();
    setImmediate(defer.resolve);
    // setTimeout(defer.resolve, 1);
    return defer.promise;
}



/**
 *
 * UdpChannel
 *
 */
function UdpChannel(conn, remotePort, remoteAddr) {
    EventEmitter.call(this);
    this.conn = conn;
    this.remotePort = remotePort;
    this.remoteAddr = remoteAddr;
    this.MTU = 1200; // TODO discover MTU
    this.RTT = 10; // TODO discover RTT
    this.receiveBytes = 0;
    this.sendBytes = 0;
    this.createTime = Date.now();
    this.lastReportTime = this.createTime;
    this.lastReportSendBytes = 0;
    this.lastReportReceiveBytes = 0;
    this.messageQueue = [];
    this.mySendPacket = this.sendPacket.bind(this);
}

// these are handlers for callbacks of UdpProtocol:
UdpChannel.prototype.sendPackets = function(packets) {
    this.checkClosed();
    return promise_utils.iterate(packets, this.mySendPacket);
};
UdpChannel.prototype.sendPacket = function(buffer) {
    this.checkClosed();
    return this.conn._send(buffer, this.remotePort, this.remoteAddr);
};
UdpChannel.prototype.handleMessage = function(buffer) {
    this.checkClosed();
    this.receiveBytes += buffer.length;
    if (this.messageQueue) {
        this.messageQueue.push(buffer);
    }
};

/**
 *
 * sendMessage
 *
 */
UdpChannel.prototype.sendMessage = function(buffer) {
    this.checkClosed();
    this.sendBytes += buffer.length;
    return this.conn.proto.sendMessage(this, buffer);
};

UdpChannel.prototype.waitForMessage = function() {
    if (!this.messageQueue) {
        throw new Error('CHANNEL NOT QUEUEING');
    }
    if (!this.messageQueue.length) {
        return Q.delay(500).then(this.waitForMessage.bind(this));
    }
    return this.messageQueue.shift();
};

UdpChannel.prototype.disableQueue = function() {
    this.messageQueue = null;
};

UdpChannel.prototype.checkClosed = function() {
    if (this.closed) {
        throw new Error('CHANNEL CLOSED');
    }
};

UdpChannel.prototype.close = function() {
    dbg.log('CHANNEL close');
    this.closed = true;
    this.disableReporter();
    this.conn._removeChannel(this);
};

UdpChannel.prototype.disableReporter = function() {
    if (this._reporterInterval) {
        clearInterval(this._reporterInterval);
        this._reporterInterval = null;
        this.report();
    }
};

UdpChannel.prototype.enableReporter = function() {
    this.checkClosed();
    if (!this._reporterInterval) {
        this._reporterInterval = setInterval(this.report.bind(this), 1000);
    }
};

UdpChannel.prototype.report = function() {
    var now = Date.now();
    if (this.sendBytes === this.lastReportSendBytes &&
        this.receiveBytes === this.lastReportReceiveBytes) {
        this.lastReportTime = now;
        return;
    }
    var sndCur = (this.sendBytes - this.lastReportSendBytes) / 1024 / 1024;
    var rcvCur = (this.receiveBytes - this.lastReportReceiveBytes) / 1024 / 1024;
    var sndCurSpeed = sndCur / (now - this.lastReportTime) * 1000;
    var rcvCurSpeed = rcvCur / (now - this.lastReportTime) * 1000;
    var snd = this.sendBytes / 1024 / 1024;
    var rcv = this.receiveBytes / 1024 / 1024;
    var sndAvgSpeed = snd / (now - this.createTime) * 1000;
    var rcvAvgSpeed = rcv / (now - this.createTime) * 1000;
    dbg.log('CHANNEL', this.remoteAddr + ':' + this.remotePort,
        ' <<SEND', snd.toFixed(3), 'MB, cur', sndCurSpeed.toFixed(3),
        'MB/s, avg', sndAvgSpeed.toFixed(3), 'MB/s>> ',
        ' <<RECEIVE', rcv.toFixed(3), 'MB, cur', rcvCurSpeed.toFixed(3),
        'MB/s, avg', rcvAvgSpeed.toFixed(3), 'MB/s>>');
    this.lastReportSendBytes = this.sendBytes;
    this.lastReportReceiveBytes = this.receiveBytes;
    this.lastReportTime = now;
};
