'use strict';

var _ = require('lodash');
var Q = require('q');
var util = require('util');
var dgram = require('dgram');
var crypto = require('crypto');
var dbg = require('noobaa-util/debug_module')(__filename);
var EventEmitter = require('events').EventEmitter;
var promise_utils = require('../util/promise_utils');
var crc32 = require('sse4_crc32');

// TODO TEMP
dbg.set_level(process.env.DBG);
crc32.calculate = function() {
    return 0;
};

module.exports = UdpProto;


function UdpProto() {
    this._sendMessageIndex = {};
    this._receiveMessageIndex = {};
    this._headerBuf = new Buffer(32);
    this._padBuf = new Buffer(64);
    this._emptyBuf = new Buffer(0);
    this._array2 = [null, null];
    this._array3 = [null, null, null];
    this.PACKET_MAGIC = 0xFEEDF33D; // looks yami
    this.CURRENT_VERSION = 1;
    this.PACKET_TYPE_DATA = 1;
    this.PACKET_TYPE_ACK = 2;
    this.ACK_PERIOD = 10;
}

/**
 *
 * sendMessage
 *
 * break message to packets, send, and receive acknoledge.
 *
 * @channel object containing:
 *  - send function(array of buffers) - sends each buffer as a packet
 *  - MTU integer max size for packets
 *  - RTT integer milliseconds taking for round trip on the channel
 *
 */
UdpProto.prototype.sendMessage = function(channel, buffer) {
    var self = this;
    var now = Date.now();
    var msg = {
        index: now,
        rand: crypto.pseudoRandomBytes(4).readUInt32BE(0),
        channel: channel,
        buffer: buffer,
        startTime: now,
        timeout: 5000,
        ackIndex: 0,
        sentAckIndex: 0,
    };
    this._sendMessageIndex[msg.index] = msg;
    self._encodeMessagePackets(msg);
    return self._sendMessageWithRetries(msg);
};

/**
 *
 * handlePacket
 *
 * assemble message from packets, and reply with acknoledge.
 * once a message is assmebled a "message" event will be emitted.
 *
 * @channel object like in sendMessage()
 *
 */
UdpProto.prototype.handlePacket = function(channel, buffer) {
    var packet = this._decodePacket(buffer);
    switch (packet.type) {
        case this.PACKET_TYPE_DATA:
            this._handleDataPacket(channel, packet);
            break;
        case this.PACKET_TYPE_ACK:
            this._handleAckPacket(channel, packet);
            break;
        default:
            dbg.error('BAD PACKET TYPE', packet.type);
            break;
    }
};



// PRIVATE METHODS ////////////////////////////////////////////////////////////


UdpProto.prototype._sendMessageWithRetries = function(msg) {
    var self = this;

    // finish when all acks received
    if (msg.ackIndex === msg.numPackets) {
        dbg.log1('SENT', msg.index, 'numPackets', msg.numPackets);
        delete self._sendMessageIndex[msg.index];
        return;
    }

    // check for timeout
    var now = Date.now();
    if (now > msg.startTime + msg.timeout) {
        return Q.reject('MESSAGE TIMEOUT');
    }

    // according to number of acks we managed to get in last attempt
    // we try to push some more this time.
    var ackRate = 2 * Math.max(50, msg.ackIndex - msg.sentAckIndex);

    // send packets, skip ones we got ack for
    msg.channel.sendPackets(msg.packets.slice(msg.ackIndex, msg.ackIndex + ackRate));
    msg.sentAckIndex = msg.ackIndex;

    // wait for acks for short time
    msg.defer = Q.defer();
    return msg.defer.promise.timeout((2 * self.ACK_PERIOD) + msg.channel.RTT)
        .then(null, function(err) {
            // retry on timeout
            dbg.warn('MSG RETRY ON TIMEOUT', msg.index,
                'numPackets', msg.numPackets,
                'ackIndex', msg.ackIndex,
                'sent', msg.sentAckIndex,
                'rate', ackRate);
            // if we made no progress at all, avoid fast retry
            if (msg.ackIndex === msg.sentAckIndex) {
                return Q.delay(Math.max(msg.timeout / 10, 2 * self.ACK_PERIOD));
            }
        })
        .then(function() {
            // recurse to retry or maybe completed
            return self._sendMessageWithRetries(msg);
        });
};

UdpProto.prototype._handleAckPacket = function(channel, packet) {
    var msg = this._sendMessageIndex[packet.msgIndex];
    if (!msg) {
        dbg.log2('ACK ON MISSING MSG', packet.msgIndex);
        return;
    }
    if (msg.channel !== channel) {
        dbg.warn('CHANNEL CHANGED ON ACK', msg.index);
        // TODO anything to do in this case?
    }
    dbg.log2('ACK ON MSG', packet.msgIndex, packet.packetIndex);
    msg.ackIndex = packet.packetIndex;
    msg.defer.resolve();
};

UdpProto.prototype._handleDataPacket = function(channel, packet) {
    var msg = this._receiveMessageIndex[packet.msgIndex];
    var now = Date.now();
    if (!msg) {
        msg = this._receiveMessageIndex[packet.msgIndex] = {
            index: packet.msgIndex,
            rand: packet.msgRand,
            channel: channel,
            startTime: now,
            ackIndex: 0,
            numPackets: packet.numPackets,
            arrivedPackets: 0,
            packets: []
        };
        msg.packets.length = packet.numPackets;
        dbg.log2('NEW MESSAGE', msg.index, 'numPackets', msg.numPackets);
    }
    this._setPacketInMessage(msg, packet);
    if (msg.channel !== channel) {
        dbg.warn('CHANNEL CHANGED');
        // TODO anything to do in this case?
        msg.channel = channel;
    }
    if (!msg.done && msg.arrivedPackets === msg.numPackets) {
        msg.done = now;
        msg.buffer = Buffer.concat(msg.packets);
        Q.fcall(this._sendAckPacket.bind(this, msg))
            .fin(this._completedMessage.bind(this, msg));
    } else {
        this._joinAckPacket(msg);
    }
};

UdpProto.prototype._completedMessage = function(msg) {
    var self = this;
    dbg.log1('RECEIVED', msg.index, 'size', msg.buffer.length, 'numPackets', msg.numPackets);
    msg.channel.handleMessage(msg.buffer);
    // TODO keep LRU of recent msg indexes to resend acks if lost
    msg.packets = null;
    msg.buffer = null;
    setTimeout(function() {
        delete self._receiveMessageIndex[msg.index];
    }, 5000);
};

UdpProto.prototype._setPacketInMessage = function(msg, packet) {
    if (msg.done) {
        dbg.log2('MSG ALREADY DONE', msg.index, packet.packetIndex);
        return;
    }
    if (msg.packets[packet.packetIndex]) {
        dbg.log2('PACKET ALREADY RECEIVED', msg.index, packet.packetIndex);
        return;
    }
    if (msg.rand !== packet.msgRand) {
        dbg.warn('PACKET MISMATCH RAND', msg.index, msg.rand, packet.msgRand);
        return;
    }
    if (msg.numPackets !== packet.numPackets) {
        dbg.warn('PACKET MISMATCH NUM PACKETS', msg.index, msg.numPackets, packet.numPackets);
        return;
    }
    msg.packets[packet.packetIndex] = packet.data;
    msg.arrivedPackets += 1;
};

UdpProto.prototype._joinAckPacket = function(msg) {
    if (!msg.ackTimeout) {
        var self = this;
        msg.ackTimeout = setTimeout(function() {
            try {
                self._sendAckPacket(msg);
            } catch (err) {
                dbg.log1('ACK TIMER FAILED', err);
            }
        }, self.ACK_PERIOD);
    }
};

UdpProto.prototype._sendAckPacket = function(msg) {
    if (msg.done) {
        msg.ackIndex = msg.numPackets;
    } else {
        // advancing ackIndex to max missing index
        while (msg.ackIndex < msg.numPackets && msg.packets[msg.ackIndex]) {
            msg.ackIndex += 1;
        }
    }
    if (msg.ackTimeout) {
        clearTimeout(msg.ackTimeout);
        msg.ackTimeout = null;
    }
    dbg.log2('SEND ACK', msg.index, msg.ackIndex);
    return msg.channel.sendPacket(this._encodePacket({
        type: this.PACKET_TYPE_ACK,
        msgIndex: msg.index,
        msgRand: msg.rand,
        packetIndex: msg.ackIndex,
        numPackets: msg.numPackets,
        checksum: 0
    }));
};

UdpProto.prototype._encodeMessagePackets = function(msg) {
    var data = msg.buffer;
    var packetDataLen = msg.channel.MTU - this._headerBuf.length;
    var packetOffset = 0;
    var packets = [];
    packets.length = Math.ceil(data.length / packetDataLen);
    for (var i = 0; i < packets.length; ++i) {
        var packetData = data.slice(packetOffset, packetOffset + packetDataLen);
        var packetBuf = this._encodePacket({
            type: this.PACKET_TYPE_DATA,
            msgIndex: msg.index,
            msgRand: msg.rand,
            packetIndex: i,
            numPackets: packets.length,
            data: packetData
        });
        packets[i] = packetBuf;
        packetOffset += packetData.length;
    }
    msg.packets = packets;
    msg.numPackets = packets.length;
};

UdpProto.prototype._encodePacket = function(packet) {
    var checksum = crc32.calculate(packet.data);
    var data = packet.data || this._emptyBuf;
    this._headerBuf.writeUInt32BE(this.PACKET_MAGIC, 0);
    this._headerBuf.writeUInt8(this.CURRENT_VERSION, 4);
    this._headerBuf.writeUInt8(packet.type, 5);
    this._headerBuf.writeUInt16BE(data.length, 6);
    this._headerBuf.writeDoubleBE(packet.msgIndex, 8);
    this._headerBuf.writeUInt32BE(packet.msgRand, 16);
    this._headerBuf.writeUInt32BE(packet.packetIndex, 20);
    this._headerBuf.writeUInt32BE(packet.numPackets, 24);
    this._headerBuf.writeUInt32BE(checksum, 28);
    // TODO checksum should be on the header too

    // pad the buffer for a sane minimum
    var len = this._headerBuf.length + data.length;
    if (len < this._padBuf.length) {
        this._array3[0] = this._headerBuf;
        this._array3[1] = data;
        this._array3[2] = this._padBuf.slice(len);
        return Buffer.concat(this._array3, this._padBuf.length);
    } else {
        this._array2[0] = this._headerBuf;
        this._array2[1] = data;
        return Buffer.concat(this._array2, len);
    }
};

UdpProto.prototype._decodePacket = function(buffer) {
    var magic = buffer.readUInt32BE(0);
    var version = buffer.readUInt8(4);
    var type = buffer.readUInt8(5);
    var dataLen = buffer.readUInt16BE(6);
    var msgIndex = buffer.readDoubleBE(8);
    var msgRand = buffer.readUInt32BE(16);
    var packetIndex = buffer.readUInt32BE(20);
    var numPackets = buffer.readUInt32BE(24);
    var checksum = buffer.readUInt32BE(28);

    if (magic !== this.PACKET_MAGIC) {
        throw new Error('BAD PACKET MAGIC ' + magic);
    }
    if (version !== this.CURRENT_VERSION) {
        throw new Error('BAD PACKET VERSION ' + version);
    }

    var data = buffer.slice(this._headerBuf.length, this._headerBuf.length + dataLen);
    if (data.length) {
        var dataChecksum = crc32.calculate(data);
        if (checksum !== dataChecksum) {
            throw new Error('BAD DATA CHECKSUM ' + dataChecksum + ' expected ', checksum);
        }
    }
    return {
        type: type,
        msgIndex: msgIndex,
        msgRand: msgRand,
        packetIndex: packetIndex,
        numPackets: numPackets,
        checksum: checksum,
        data: data
    };
};




util.inherits(UdpSocket, EventEmitter);
util.inherits(UdpChannel, EventEmitter);


/**
 *
 * UdpSocket
 *
 */
function UdpSocket(localPort) {
    this.proto = new UdpProto();
    this.channels = {};
    this.socket = dgram.createSocket('udp4');
    this.socket.on('message', this._onSocketMessage.bind(this));
    this.socket.bind(localPort, this._onSocketBind.bind(this));
}

UdpSocket.prototype.getChannel = function(remotePort, remoteAddr) {
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

UdpSocket.prototype.close = function() {
    dbg.log('SOCKET close');
    this.socket.close();
    _.each(this.channels, function(channel) {
        channel.close();
    });
    this.channels = null;
    this.closed = true;
};

UdpSocket.prototype.checkClosed = function() {
    if (this.closed) {
        throw new Error('SOCKET CLOSED');
    }
};

UdpSocket.prototype._removeChannel = function(channel) {
    var key = channel.remoteAddr + ':' + channel.remotePort;
    if (this.channels && this.channels[key] === channel) {
        delete this.channels[key];
    }
};

UdpSocket.prototype._send = function(buffer, remotePort, remoteAddr) {
    dbg.log2('SOCKET send to', remoteAddr + ':' + remotePort, 'buffer', buffer.length);
    this.checkClosed();
    return Q.ninvoke(this.socket, 'send', buffer, 0, buffer.length, remotePort, remoteAddr)
        .then(immediateQ);
};

UdpSocket.prototype._onSocketMessage = function(buffer, rinfo) {
    dbg.log2('SOCKET packet from', rinfo, 'buffer', buffer.length);
    var channel = this.getChannel(rinfo.port, rinfo.address);
    this.proto.handlePacket(channel, buffer);
};

UdpSocket.prototype._onSocketBind = function() {
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
function UdpChannel(socket, remotePort, remoteAddr) {
    EventEmitter.call(this);
    this.socket = socket;
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

// these are handlers for callbacks of UdpProto:
UdpChannel.prototype.sendPackets = function(packets) {
    this.checkClosed();
    return promise_utils.iterate(packets, this.mySendPacket);
};
UdpChannel.prototype.sendPacket = function(buffer) {
    this.checkClosed();
    return this.socket._send(buffer, this.remotePort, this.remoteAddr);
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
    return this.socket.proto.sendMessage(this, buffer);
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
    this.socket._removeChannel(this);
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

// TEST ///////////////////////////////////////////////////////////////////////


function main() {
    var isClient = !!process.env.CLIENT;
    var localPort = isClient ? 0 : 5800;
    var socket = new UdpSocket(localPort);
    socket.on('channel', function(channel) {
        channel.enableReporter();
        if (!isClient) {
            serverMain(channel);
        }
    });
    if (isClient) {
        socket.on('ready', clientMain);
    }

    function clientMain() {
        var remoteAddr = process.env.CLIENT || '127.0.0.1';
        var remotePort = parseInt(process.env.PORT, 10) || 5800;
        var messageSize = parseInt(process.env.MSG, 10) || 128 * 1024;
        var sendSize = (parseInt(process.env.SEND, 10) || 0) * 1024 * 1024;
        var receiveSize = (parseInt(process.env.RECV, 10) || 0) * 1024 * 1024;
        var MTU = parseInt(process.env.MTU, 10);
        var RTT = parseInt(process.env.RTT, 10);
        var channel = socket.getChannel(remotePort, remoteAddr);
        if (MTU) {
            channel.MTU = MTU;
        }
        if (RTT) {
            channel.RTT = RTT;
        }

        return Q.fcall(function() {
                // first message is the spec of the test to create the connection
                var remoteSpec = {
                    sendSize: receiveSize,
                    receiveSize: sendSize,
                    messageSize: messageSize,
                    MTU: MTU,
                    RTT: RTT,
                };
                dbg.log('SEND SPEC');
                return channel.sendMessage(new Buffer(JSON.stringify(remoteSpec)));
            })
            .then(function() {
                dbg.log('WAIT SPEC ACK');
                return channel.waitForMessage();
            })
            .then(function(buffer) {
                channel.disableQueue();
                var spec = {
                    sendSize: sendSize,
                    receiveSize: receiveSize,
                    messageSize: messageSize,
                };
                return runSpec(channel, spec);
            })
            .then(function() {
                dbg.log('CLIENT DONE');
                socket.close();
            }, function(err) {
                dbg.error('CLIENT ERROR', err.stack || err);
                socket.close();
            });
    }

    function serverMain(channel) {
        // receive the test spec message
        var spec;
        return Q.fcall(function() {
                dbg.log('WAIT FOR SPEC');
                return channel.waitForMessage();
            })
            .then(function(buffer) {
                channel.disableQueue();
                // parse and send back the spec message to let the client know we can start
                spec = JSON.parse(buffer.toString());
                dbg.log('RECEIVED SPEC');
                if (spec.MTU) {
                    channel.MTU = spec.MTU;
                }
                if (spec.RTT) {
                    channel.RTT = spec.RTT;
                }
                return channel.sendMessage(buffer);
            })
            .then(function() {
                return runSpec(channel, spec);
            })
            .then(function() {
                dbg.log('SERVER DONE');
                channel.close();
            }, function(err) {
                dbg.log('SERVER ERROR', err.stack || err);
                channel.close();
            });
    }

    function runSpec(channel, spec) {
        dbg.log('RUN SPEC', spec);
        return Q.all([
            waitForReceiveBytes(channel, spec.receiveSize),
            sendOnChannel(channel, spec.sendSize, spec.messageSize)
        ]);
    }

    function waitForReceiveBytes(channel, receiveSize) {
        if (channel.receiveBytes >= receiveSize) {
            dbg.log('RECEIVE DONE', channel.receiveBytes);
            return;
        }
        return Q.delay(1).then(waitForReceiveBytes.bind(null, channel, receiveSize));
    }

    function sendOnChannel(channel, sendSize, messageSize) {
        var buffer = new Buffer(messageSize);
        return sendNext();

        function sendNext() {
            if (channel.sendBytes >= sendSize) {
                dbg.log('SEND DONE', channel.sendBytes);
                return;
            }
            return channel.sendMessage(buffer).then(sendNext);
        }
    }

}

if (require.main === module) {
    main();
}
