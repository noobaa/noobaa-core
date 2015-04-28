'use strict';

var _ = require('lodash');
var Q = require('q');
var ip = require('ip');
var util = require('util');
var dgram = require('dgram');
var crypto = require('crypto');

module.exports = {
    request: request,
    indicate: indicate,
    packet_from_message: packet_from_message,
    test: test,
};

/**
 * send stun request.
 * the stun server should send a reply on this socket.
 */
function request(socket, stun_port, stun_host) {
    var packet = new StunPacket('request');
    return Q.ninvoke(socket, 'send',
        packet.buffer, 0, packet.buffer.length,
        stun_port, stun_host);
}

/**
 * send stun indication.
 * this is essentialy a keep alive that does not require reply from the stun server.
 */
function indicate(socket, stun_port, stun_host) {
    var packet = new StunPacket('indication');
    return Q.ninvoke(socket, 'send',
        packet.buffer, 0, packet.buffer.length,
        stun_port, stun_host);
}

/**
 * returns null if not stun message
 */
function packet_from_message(msg) {
    if (StunPacket.is_stun_packet(msg)) {
        return new StunPacket(msg);
    }
}

/**
 *
 */
function test(stun_port, stun_host) {
    var socket = dgram.createSocket('udp4');
    socket.on('message', function(msg, rinfo) {
        var packet = packet_from_message(msg);
        if (packet) {
            var attrs = packet.get_attrs();
            console.log('STUN METHOD:', packet.get_method());
            _.each(attrs, function(attr) {
                console.log('STUN ATTR:', attr.attr, util.inspect(attr.value, {
                    depth: null
                }));
            });
        }
        socket.close();
    });
    return request(socket, stun_port, stun_host)
        .then(function() {
            console.log('SOCKET ADDRESS', socket.address());
            return socket;
        });
}

if (require.main === module) {
    setImmediate(function() {
        test(19302, 'stun.l.google.com');
    });
}



/**
 * StunPacket Class
 */
function StunPacket(buffer_or_method_name) {
    if (Buffer.isBuffer(buffer_or_method_name)) {
        this.buffer = buffer_or_method_name;
    } else {
        this.buffer = new Buffer(StunPacket.HEADER_LENGTH);
        // class and method
        this.buffer.writeUInt16BE(StunPacket.BINDING_CLASS | StunPacket.METHOD.REQUEST, 0);
        // attrs len
        this.buffer.writeUInt16BE(0, 2);
        // magic key is a constant
        this.buffer.writeUInt32BE(StunPacket.MAGIC_KEY, 4);
        // 96bit transaction id
        crypto.pseudoRandomBytes(12).copy(this.buffer, 8);

        // treat the argument as a method name
        if (buffer_or_method_name) {
            this.set_method(buffer_or_method_name);
        }
    }
}

StunPacket.prototype.is_stun_packet = function() {
    return StunPacket.is_stun_packet(this.buffer);
};

StunPacket.prototype.get_method = function() {
    var val = this.buffer.readUInt16BE(0) & StunPacket.METHOD_MASK;
    return StunPacket.METHOD_NAMES[val];
};

StunPacket.prototype.set_method = function(method_name) {
    method_name = method_name.toUpperCase();
    if (!(method_name in StunPacket.METHOD)) {
        throw new Error('bad stun method');
    }
    var method_code = StunPacket.METHOD[method_name];
    var val = StunPacket.BINDING_CLASS | method_code;
    this.buffer.writeUInt16BE(val, 0);
};

StunPacket.prototype.get_attr_len = function() {
    return this.buffer.readUInt16BE(2);
};

StunPacket.prototype.set_attr_len = function(len) {
    return this.buffer.readUInt16BE(len, 2);
};

// Decode packet attributes
StunPacket.prototype.get_attrs = function() {
    var buf = this.buffer;
    var attrs = [];
    var offset = StunPacket.HEADER_LENGTH;
    var end = offset + this.get_attr_len();

    while (offset < end) {
        var type = buf.readUInt16BE(offset);
        offset += 2;
        var length = buf.readUInt16BE(offset);
        offset += 2;

        var value;
        switch (type) {
            case StunPacket.ATTR.MAPPED_ADDRESS:
                value = this.decode_attr_mapped_addr(offset, offset + length);
                break;
            case StunPacket.ATTR.XOR_MAPPED_ADDRESS:
                value = this.decode_attr_xor_mapped_addr(offset, offset + length);
                break;
            case StunPacket.ATTR_ERROR_CODE:
                value = this.decode_attr_error_code(offset, offset + length);
                break;
            case StunPacket.UNKNOWN_ATTRIBUTES:
                value = this.decode_attr_unknown_attr(offset, offset + length);
                break;
            default:
                // TODO bad attribute?
                break;
        }

        attrs.push({
            attr: StunPacket.ATTR_NAMES[type],
            value: value,
        });

        // align offset to 4 bytes
        offset += length;
        offset += 4 - (offset % 4);
    }

    return attrs;
};

// Decode MAPPED-ADDRESS value
StunPacket.prototype.decode_attr_mapped_addr = function(start, end) {
    var buf = this.buffer;
    var family = (buf.readUInt16BE(start) === 0x02) ? 6 : 4;
    var port = buf.readUInt16BE(start + 2);
    var address = ip.toString(buf, start + 4, family);

    return {
        family: 'IPv' + family,
        port: port,
        address: address
    };
};

// Decode MAPPED-ADDRESS value
StunPacket.prototype.decode_attr_xor_mapped_addr = function(start, end) {
    var buf = this.buffer;
    var family = (buf.readUInt16BE(start) === 0x02) ? 6 : 4;

    // xor the port against the magic key
    var port = buf.readUInt16BE(start + 2) ^
        buf.readUInt16BE(StunPacket.XOR_KEY_OFFSET);

    // xor the address against magic key and tid
    var addr_buf = buf.slice(start + 4, end);
    var xor_buf = new Buffer(addr_buf.length);
    var k = StunPacket.XOR_KEY_OFFSET;
    for (var i = 0; i < xor_buf.length; ++i) {
        xor_buf[i] = addr_buf[i] ^ buf[k++];
    }
    var address = ip.toString(xor_buf, 0, family);

    return {
        family: 'IPv' + family,
        port: port,
        address: address
    };
};

// Decode ERROR-CODE value
StunPacket.prototype.decode_attr_error_code = function(start, end) {
    var buf = this.buffer;
    var block = buf.readUInt32BE(start);
    var code = (block & 0x700) * 100 + block & 0xff;
    var reason = buf.readUInt32BE(start + 4);

    return {
        code: code,
        reason: reason
    };
};

// Decode UNKNOWN-ATTRIBUTES value
StunPacket.prototype.decode_attr_unknown = function(start, end) {
    var buf = this.buffer;
    var unknown_attrs = [];
    var offset = start;

    while (offset < end) {
        unknown_attrs.push(buf.readUInt16BE(offset));
        offset += 2;
    }

    return unknown_attrs;
};


// Determines whether STUN StunPacket
StunPacket.is_stun_packet = function(buf) {
    var block = buf.readUInt8(0);
    var bit1 = block & 0x80;
    var bit2 = block & 0x40;
    return bit1 === 0 && bit2 === 0;
};

// StunPacket header length
StunPacket.HEADER_LENGTH = 20;
// STUN magic key
StunPacket.MAGIC_KEY = 0x2112A442;
// The key for XOR_MAPPED_ADDRESS includes magic key and transaction id
StunPacket.XOR_KEY_OFFSET = 4;
// Binding Class
StunPacket.BINDING_CLASS = 0x0001;

// STUN Method
StunPacket.METHOD_MASK = 0x0110;
StunPacket.METHOD = {
    REQUEST: 0x0000,
    INDICATION: 0x0010,
    SUCCESS: 0x0100,
    ERROR: 0x0110
};
StunPacket.METHOD_NAMES =
    _.invert(StunPacket.METHOD);

// Attributes
StunPacket.ATTR = {
    MAPPED_ADDRESS: 0x0001,
    USERNAME: 0x0006,
    MESSAGE_INTEGRITY: 0x0008,
    ERROR_CODE: 0x0009,
    UNKNOWN_ATTRIBUTES: 0x000A,
    REALM: 0x0014,
    NONCE: 0x0015,
    XOR_MAPPED_ADDRESS: 0x0020,
    SOFTWARE: 0x8022,
    ALTERNATE_SERVER: 0x8023,
    FINGERPRINT: 0x8028
};
StunPacket.ATTR_NAMES =
    _.invert(StunPacket.ATTR);

// Error code
StunPacket.ERROR_CODE = {
    300: 'Try Alternate',
    400: 'Bad Request',
    401: 'Unauthorized',
    420: 'Unknown Attribute',
    438: 'Stale Nonce',
    500: 'Server Error'
};
