'use strict';

var _ = require('lodash');
var Q = require('q');
var crypto = require('crypto');
var dbg = require('noobaa-util/debug_module')(__filename);
var crc32 = require('sse4_crc32');
crc32.calculate = function() { return 0; };

module.exports = MsgProto;


function MsgProto() {
    this._sendMessageIndex = {};
    this._receiveMessageIndex = {};
    this._headerBuf = new Buffer(28);
    this.PACKET_MAGIC = 0xF00D; // looks yami
    this.CURRENT_VERSION = 1;
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
    };
    this._sendMessageIndex[msg.index] = msg;
    self._encodeMessagePackets(channel, msg);
    channel.send(msg.packets);
};

/**
 *
 * handlePacket
 *
 * assemble message from packets, and reply with acknoledge.
 * once a message is assmebled a "message" event will be emitted.
 *
 * @channel object
 *
 */
MsgProto.prototype.handlePacket = function(channel, buffer) {
    var packet = this._decodePacket(buffer);
    var msg = this._receiveMessageIndex[packet.msgIndex];
    var now = Date.now();
    if (!msg) {
        msg = this._receiveMessageIndex[packet.msgIndex] = {
            index: packet.msgIndex,
            rand: packet.msgRand,
            channel: channel,
            time: now,
            packets: [],
            arrivedPackets: 0
        };
        msg.packets.length = packet.numPackets;
    }
    if (msg.packets[packet.packetIndex]) {
        dbg.warn('PACKET ALREADY RECEIVED', msg, packet);
        return;
    }
    if (msg.rand !== packet.msgRand) {
        dbg.warn('PACKET MISMATCH RAND', msg, packet);
        return;
    }
    if (msg.packets.length !== packet.numPackets) {
        dbg.warn('PACKET MISMATCH NUM PACKETS', msg, packet);
        return;
    }
    msg.packets[packet.packetIndex] = packet.data;
    msg.arrivedPackets += 1;
    if (!msg.emitted && msg.arrivedPackets === msg.packets.length) {
        msg.emitted = now;
        msg.buffer = Buffer.concat(msg.packets);
        channel.handleMessage(msg.buffer);
        // TODO send acknowledge and release msg
        delete this._receiveMessageIndex[packet.msgIndex];
    }
};



// PRIVATE METHODS ////////////////////////////////////////////////////////////


MsgProto.prototype._allocateSendMessageIndex = function() {
    var index = Date.now() + Math.random().toString(16).slice(1);
    while (this._sendMessageIndex[index]) {
        index = Date.now() + Math.random().toString(16).slice(1);
    }
    return index;
};

MsgProto.prototype._encodeMessagePackets = function(channel, msg) {
    var data = msg.buffer;
    var packetDataLen = channel.mtu - this._headerBuf.length;
    var packetOffset = 0;
    var packets = [];
    packets.length = Math.ceil(data.length / packetDataLen);
    for (var i = 0; i< packets.length; ++i) {
        var packetData = data.slice(packetOffset, packetOffset + packetDataLen);
        var packetBuf = this._encodePacket({
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
    this._headerBuf.writeUInt16BE(this.PACKET_MAGIC, pos);
    pos += 2;
    this._headerBuf.writeUInt16BE(this.CURRENT_VERSION, pos);
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
    return Buffer.concat([this._headerBuf, packet.data]);
};

MsgProto.prototype._decodePacket = function(buffer) {
    var pos = 0;
    var magic = buffer.readUInt16BE(pos);
    pos += 2;
    var version = buffer.readUInt16BE(pos);
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
    var dataChecksum = crc32.calculate(data);
    if (checksum !== checksum) {
        throw new Error('BAD DATA CHECKSUM');
    }
    return {
        msgIndex: msgIndex,
        msgRand: msgRand,
        packetIndex: packetIndex,
        numPackets: numPackets,
        checksum: checksum,
        data: data
    };
};
