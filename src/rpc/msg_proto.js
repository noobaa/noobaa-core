'use strict';

var _ = require('lodash');
var Q = require('q');
var dbg = require('noobaa-util/debug_module')(__filename);
var crc32 = require('sse4_crc32');
crc32.calculate = function() { return 0; };

module.exports = MsgProto;


function MsgProto() {
    this._sendMessageIndex = {};
    this._receiveMessageIndex = {};
    this._prefixBuf = new Buffer(8);
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
        index: self._allocateSendMessageIndex(),
        channel: channel,
        buffer: buffer,
        time: Date.now()
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
    var msg = this._receiveMessageIndex[packet.header.m];
    var now = Date.now();
    if (!msg) {
        msg = this._receiveMessageIndex[packet.header.m] = {
            index: packet.header.m,
            channel: channel,
            time: now,
            packets: [],
            arrivedPackets: 0
        };
        msg.packets.length = packet.header.n;
    }
    if (msg.packets[packet.header.p]) {
        dbg.warn('PACKET ALREADY RECEIVED', packet.header);
        return;
    }
    if (msg.packets.length !== packet.header.n) {
        dbg.warn('PACKET MISMATCH NUM PACKETS', packet.header);
        return;
    }
    msg.packets[packet.header.p] = packet.data;
    msg.arrivedPackets += 1;
    if (!msg.emitted && msg.arrivedPackets === msg.packets.length) {
        msg.emitted = now;
        msg.buffer = Buffer.concat(msg.packets);
        channel.handleMessage(msg.buffer);
        // TODO send acknowledge and release msg
        delete this._receiveMessageIndex[packet.header.m];
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
    var packetHeaderReserve = 128;
    var packetDataLen = channel.mtu - packetHeaderReserve;
    var packetOffset = 0;
    var packets = [];
    packets.length = Math.ceil(data.length / packetDataLen);
    for (var i = 0; i< packets.length; ++i) {
        var packetData = data.slice(packetOffset, packetOffset + packetDataLen);
        var packetBuf = this._encodePacket(packetData, msg.index, i, packets.length);
        if (packetBuf.length > channel.mtu) {
            throw new Error('CHANNEL MTU EXCEEDED ' + packetBuf.length + ' > ' + channel.mtu);
        }
        packets[i] = packetBuf;
        packetOffset += packetData.length;
    }
    msg.packets = packets;
};

MsgProto.prototype._encodePacket = function(dataBuf, msgIndex, packetIndex, numPackets) {
    var header = {
        m: msgIndex,
        p: packetIndex,
        n: numPackets,
        c: crc32.calculate(dataBuf),
    };
    var headerBuf = new Buffer(JSON.stringify(header));
    var headerEnd = headerBuf.length + this._prefixBuf.length;
    this._prefixBuf.writeUInt16BE(this.PACKET_MAGIC, 0);
    this._prefixBuf.writeUInt16BE(this.CURRENT_VERSION, 2);
    this._prefixBuf.writeUInt32BE(headerEnd, 4);
    return Buffer.concat(
        [this._prefixBuf, headerBuf, dataBuf],
        headerEnd + dataBuf.length);
};

MsgProto.prototype._decodePacket = function(buffer) {
    var magic = buffer.readUInt16BE(0);
    var version = buffer.readUInt16BE(2);
    var headerEnd = buffer.readUInt32BE(4);
    if (magic !== this.PACKET_MAGIC) {
        throw new Error('BAD PACKET MAGIC ' + magic);
    }
    if (version !== this.CURRENT_VERSION) {
        throw new Error('BAD PACKET VERSION ' + version);
    }
    var headerBuf = buffer.slice(this._prefixBuf.length, headerEnd);
    var data = buffer.slice(headerEnd);
    var header = JSON.parse(headerBuf.toString());
    var checksum = crc32.calculate(data);
    if (checksum !== header.c) {
        throw new Error('BAD DATA CHECKSUM');
    }
    return {
        header: header,
        data: data
    };
};
