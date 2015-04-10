'use strict';

var _ = require('lodash');
var Q = require('q');
var util = require('util');
var dgram = require('dgram');
var EventEmitter = require('events').EventEmitter;
var MsgProto = require('./msg_proto');
var promise_utils = require('../util/promise_utils');
var dbg = require('noobaa-util/debug_module')(__filename);

util.inherits(UdpSocket, EventEmitter);
util.inherits(UdpChannel, EventEmitter);


/**
 *
 * UdpSocket
 *
 */
function UdpSocket(localPort) {
    this.proto = new MsgProto();
    this.channels = {};
    this.socket = dgram.createSocket('udp4');
    this.socket.on('message', this._onSocketMessage.bind(this));
    this.socket.bind(localPort, this._onSocketBind.bind(this));
}

UdpSocket.prototype.getChannel = function(remotePort, remoteAddr) {
    var key = remoteAddr + ':' + remotePort;
    var channel = this.channels[key];
    if (!channel) {
        channel = this.channels[key] = new UdpChannel(this, remotePort, remoteAddr);
        this.emit('channel', channel);
    }
    return channel;
};

UdpSocket.prototype.close = function() {
    this.socket.close();
};

UdpSocket.prototype._send = function(buffer, remotePort, remoteAddr) {
    dbg.log1('UDP send to', remoteAddr + ':' + remotePort, 'buffer', buffer.length);
    return Q.ninvoke(this.socket, 'send', buffer, 0, buffer.length, remotePort, remoteAddr)
        .then(immediateQ);
};

UdpSocket.prototype._onSocketMessage = function(buffer, rinfo) {
    dbg.log1('UDP message from', rinfo, 'buffer', buffer.length);
    var channel = this.getChannel(rinfo.port, rinfo.address);
    this.proto.handlePacket(channel, buffer);
};

UdpSocket.prototype._onSocketBind = function() {
    dbg.log('UDP bind ready', this.socket.address());
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
function UdpChannel(socket, remotePort, remoteAddr) {
    EventEmitter.call(this);
    this.socket = socket;
    this.remotePort = remotePort;
    this.remoteAddr = remoteAddr;
    this.MTU = 1200; // TODO discover MTU
    this.RTT = 10; // TODO discover RTT
    this.receiveBytes = 0;
    this.sendBytes = 0;
    this.mySend = this.send.bind(this);
}

UdpChannel.prototype.sendMulti = function(packets) {
    return promise_utils.iterate(packets, this.mySend);
};

UdpChannel.prototype.send = function(buffer) {
    return this.socket._send(buffer, this.remotePort, this.remoteAddr);
};

UdpChannel.prototype.handleMessage = function(buffer) {
    this.receiveBytes += buffer.length;
    this.emit('message', buffer);
};

UdpChannel.prototype.sendMessage = function(buffer) {
    this.sendBytes += buffer.length;
    return this.socket.proto.sendMessage(this, buffer);
};


// TEST ///////////////////////////////////////////////////////////////////////


var socket = new UdpSocket(
    process.env.CLIENT ? 0 : 5800 // local port
);
socket.on('channel', channelReport);
if (process.env.CLIENT) {
    socket.on('ready', clientMain);
}

function clientMain() {
    var channel = socket.getChannel(
        process.env.RP || 5800, // remote port
        process.env.RA || '127.0.0.1' // remote addr
    );
    if (process.env.MTU) {
        channel.MTU = process.env.MTU;
    }
    clientNext();

    function clientNext() {
        if (channel.sendBytes >= 1024 * 1024 * 1024) {
            dbg.log('CLIENT DONE');
            socket.close();
            return;
        }
        return channel.sendMessage(new Buffer(128 * 1024))
            .then(clientNext, function(err) {
                dbg.error('CLIENT ERROR', err);
                socket.close();
            });
    }
}

function channelReport(channel) {
    var lastSendBytes = channel.sendBytes;
    var lastReceiveBytes = channel.receiveBytes;
    var lastTime = Date.now();
    var startTime = Date.now();
    setInterval(function() {
        var now = Date.now();
        if (channel.sendBytes === lastSendBytes &&
            channel.receiveBytes === lastReceiveBytes) {
            lastTime = now;
            return;
        }
        var sndCur = (channel.sendBytes - lastSendBytes) / 1024 / 1024;
        var rcvCur = (channel.receiveBytes - lastReceiveBytes) / 1024 / 1024;
        var sndCurSpeed = sndCur / (now - lastTime) * 1000;
        var rcvCurSpeed = rcvCur / (now - lastTime) * 1000;
        var snd = channel.sendBytes / 1024 / 1024;
        var rcv = channel.receiveBytes / 1024 / 1024;
        var sndAvgSpeed = snd / (now - startTime) * 1000;
        var rcvAvgSpeed = rcv / (now - startTime) * 1000;
        dbg.log('CHANNEL', channel.remoteAddr + ':' + channel.remotePort,
            '*** SEND', snd, 'MB, cur', sndCurSpeed.toFixed(1),
            'MB/s, avg', sndAvgSpeed.toFixed(1), 'MB/s',
            '*** RECEIVE', rcv, 'MB, cur', rcvCurSpeed.toFixed(1),
            'MB/s, avg', rcvAvgSpeed.toFixed(1), 'MB/s');
        lastSendBytes = channel.sendBytes;
        lastReceiveBytes = channel.receiveBytes;
        lastTime = now;
    }, 1000);
}
