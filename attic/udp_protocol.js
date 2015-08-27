'use strict';

var _ = require('lodash');
var Q = require('q');
var util = require('util');
var dgram = require('dgram');
var crypto = require('crypto');
var dbg = require('../util/debug_module')(__filename);
var EventEmitter = require('events').EventEmitter;
var promise_utils = require('../util/promise_utils');
// TODO Temporary disabled CRC
var crc32 = /*require('sse4_crc32');*/ {
    calculate: function() {
        return 0;
    }
};


module.exports = UdpProtocol;

/**
 *
 * UdpProtocol
 *
 * a logical protocol for managing messages transmission over udp transport
 * by splitting to MTU packets and assembling back, retransmissions, and acks.
 *
 * the actual udp send/receive is not here and is provided a channel object
 * capable of sending packets (channel.sendPacket/s),
 * and informing the protocol on arrival of packets (protocol.handlePacket).
 *
 * @channel object containing:
 *  - send function(array of buffers) - sends each buffer as a packet
 *  - MTU integer max size for packets
 *  - RTT integer milliseconds taking for round trip on the channel
 *
 */
function UdpProtocol() {
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
 * @channel object as described in UdpProtocol()
 *
 */
UdpProtocol.prototype.sendMessage = function(channel, buffer) {
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
 * @channel object as described in UdpProtocol()
 *
 */
UdpProtocol.prototype.handlePacket = function(channel, buffer) {
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


UdpProtocol.prototype._sendMessageWithRetries = function(msg) {
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

UdpProtocol.prototype._handleAckPacket = function(channel, packet) {
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

UdpProtocol.prototype._handleDataPacket = function(channel, packet) {
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

UdpProtocol.prototype._completedMessage = function(msg) {
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

UdpProtocol.prototype._setPacketInMessage = function(msg, packet) {
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

UdpProtocol.prototype._joinAckPacket = function(msg) {
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

UdpProtocol.prototype._sendAckPacket = function(msg) {
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

/**
 * TODO: this has a cpu overhead because it allocates lots of small buffers.
 * There are two ways to reduce:
 * 1. preallocate packet buffers, and use copy, instead of slicing.
 * 2. write this in C++ and create a native message memory with all the data in a big chunk,
 * and then passed to sendPackets() with packet indexes to send.
 */
UdpProtocol.prototype._encodeMessagePackets = function(msg) {
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

UdpProtocol.prototype._encodePacket = function(packet) {
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

UdpProtocol.prototype._decodePacket = function(buffer) {
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
