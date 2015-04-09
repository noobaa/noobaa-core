'use strict';

var _ = require('lodash');
var Q = require('q');
var crypto = require('crypto');
var dbg = require('noobaa-util/debug_module')(__filename);
var promise_utils = require('../util/promise_utils');
var crc32 = require('sse4_crc32');
crc32.calculate = function() {
    return 0;
};

module.exports = MsgProto;


function MsgProto() {
    this._sendMessageIndex = {};
    this._receiveMessageIndex = {};
    this._headerBuf = new Buffer(32);
    this.PACKET_MAGIC = 0xF00DF00D; // looks yami
    this.CURRENT_VERSION = 1;
    this.PACKET_TYPE_DATA = 1;
    this.PACKET_TYPE_ACK = 2;
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
MsgProto.prototype.sendMessage = function(channel, buffer) {
    var self = this;
    var msg = {
        index: Date.now(),
        rand: crypto.pseudoRandomBytes(4).readUInt32BE(0),
        channel: channel,
        buffer: buffer,
        defer: Q.defer(),
        attempt: 0,
        retries: 5,
        timeout: 2000
    };
    this._sendMessageIndex[msg.index] = msg;
    self._encodeMessagePackets(channel, msg);
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
MsgProto.prototype.handlePacket = function(channel, buffer) {
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


MsgProto.prototype._sendMessageWithRetries = function(msg) {
    var self = this;
    // check attempts
    msg.attempt += 1;
    if (msg.attempt > msg.retries) {
        return Q.reject('MESSAGE TIMEOUT');
    }
    if (msg.attempt > 1) {
        dbg.warn('MSG RESEND ON TIMEOUT', msg.index);
    }
    // send packets, skip ones we got ack for
    msg.channel.send(msg.ackIndex ?
        msg.packets.slice(msg.ackIndex) :
        msg.packets
    );
    return msg.defer.promise.timeout(msg.timeout)
        .then(function() {
            // success, ack received before timeout
            delete self._sendMessageIndex[msg.index];
        }, function(err) {
            // on timeout, continue to next attempt
            // on ack, allow another retry, because we make progress
            if (err === 'ACK') {
                msg.retries += 1;
            }
            return self._sendMessageWithRetries(msg);
        });
};

MsgProto.prototype._handleDataPacket = function(channel, packet) {
    var msg = this._receiveMessageIndex[packet.msgIndex];
    var now = Date.now();
    if (!msg) {
        msg = this._receiveMessageIndex[packet.msgIndex] = {
            index: packet.msgIndex,
            rand: packet.msgRand,
            channel: channel,
            time: now,
            ackTime: now,
            packets: [],
            arrivedPackets: 0
        };
        msg.packets.length = packet.numPackets;
    }
    if (msg.packets[packet.packetIndex]) {
        dbg.warn('PACKET ALREADY RECEIVED', msg.index, packet.packetIndex);
        return;
    }
    if (msg.rand !== packet.msgRand) {
        dbg.warn('PACKET MISMATCH RAND', msg.index, msg.rand, packet.msgRand);
        return;
    }
    if (msg.packets.length !== packet.numPackets) {
        dbg.warn('PACKET MISMATCH NUM PACKETS', msg.index, msg.packets.length, packet.numPackets);
        return;
    }
    msg.packets[packet.packetIndex] = packet.data;
    msg.arrivedPackets += 1;
    if (!msg.emitted && msg.arrivedPackets === msg.packets.length) {
        msg.emitted = now;
        msg.buffer = Buffer.concat(msg.packets);
        // send ack
        channel.send([this._encodePacket({
            type: this.PACKET_TYPE_ACK,
            msgIndex: msg.index,
            msgRand: msg.rand,
            packetIndex: msg.packets.length,
            numPackets: msg.packets.length,
            checksum: 0
        })]);
        channel.handleMessage(msg.buffer);
        // TODO keep LRU of recent msg indexes to resend acks if lost
        delete this._receiveMessageIndex[packet.msgIndex];
    } else {
        if (now - msg.ackTime > 500) {
            // look for next missing packet index
            for (var ackIndex = 0; ackIndex < msg.packets.length; ++ackIndex) {
                if (!msg.packets[ackIndex]) {
                    break;
                }
            }
            channel.send([this._encodePacket({
                type: this.PACKET_TYPE_ACK,
                msgIndex: msg.index,
                msgRand: msg.rand,
                packetIndex: ackIndex,
                numPackets: msg.packets.length,
                checksum: 0
            })]);
        }
    }
};

MsgProto.prototype._handleAckPacket = function(channel, packet) {
    var msg = this._sendMessageIndex[packet.msgIndex];
    if (!msg) {
        dbg.warn('ACK ON MISSING MSG', packet.msgIndex);
        return;
    }
    msg.ackIndex = packet.packetIndex;
    if (msg.ackIndex === msg.packets.length) {
        msg.defer.resolve();
    } else {
        // wakup retry on ack
        msg.defer.reject('ACK');
    }
};

MsgProto.prototype._encodeMessagePackets = function(channel, msg) {
    var data = msg.buffer;
    var packetDataLen = channel.MTU - this._headerBuf.length;
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
};

MsgProto.prototype._encodePacket = function(packet) {
    var pos = 0;
    var checksum = crc32.calculate(packet.data);
    this._headerBuf.writeUInt32BE(this.PACKET_MAGIC, pos);
    pos += 4;
    this._headerBuf.writeUInt16BE(this.CURRENT_VERSION, pos);
    pos += 2;
    this._headerBuf.writeUInt16BE(packet.type, pos);
    pos += 2;
    this._headerBuf.writeDoubleBE(packet.msgIndex, pos);
    pos += 8;
    this._headerBuf.writeUInt32BE(packet.msgRand, pos);
    pos += 4;
    this._headerBuf.writeUInt32BE(packet.packetIndex, pos);
    pos += 4;
    this._headerBuf.writeUInt32BE(packet.numPackets, pos);
    pos += 4;
    this._headerBuf.writeUInt32BE(checksum, pos);
    pos += 4;
    // TODO checksum should be on the header too
    return Buffer.concat([this._headerBuf, packet.data || new Buffer(0)]);
};

MsgProto.prototype._decodePacket = function(buffer) {
    var pos = 0;
    var magic = buffer.readUInt32BE(pos);
    pos += 4;
    var version = buffer.readUInt16BE(pos);
    pos += 2;
    var type = buffer.readUInt16BE(pos);
    pos += 2;
    var msgIndex = buffer.readDoubleBE(pos);
    pos += 8;
    var msgRand = buffer.readUInt32BE(pos);
    pos += 4;
    var packetIndex = buffer.readUInt32BE(pos);
    pos += 4;
    var numPackets = buffer.readUInt32BE(pos);
    pos += 4;
    var checksum = buffer.readUInt32BE(pos);
    pos += 4;

    if (magic !== this.PACKET_MAGIC) {
        throw new Error('BAD PACKET MAGIC ' + magic);
    }
    if (version !== this.CURRENT_VERSION) {
        throw new Error('BAD PACKET VERSION ' + version);
    }

    var data = buffer.slice(this._headerBuf.length);
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
