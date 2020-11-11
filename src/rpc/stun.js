/* Copyright (C) 2016 NooBaa */
/* eslint-disable no-bitwise */
'use strict';

const _ = require('lodash');
const util = require('util');
const P = require('../util/promise');
const url = require('url');
const dgram = require('dgram');
const crypto = require('crypto');
const ip_module = require('ip');
const chance = require('chance')();

// https://tools.ietf.org/html/rfc5389
const stun = {

    is_stun_packet: is_stun_packet,
    new_packet: new_packet,
    get_method_field: get_method_field,
    get_method_name: get_method_name,
    set_method_field: set_method_field,
    set_method_name: set_method_name,
    get_attrs_len_field: get_attrs_len_field,
    set_attrs_len_field: set_attrs_len_field,
    set_magic_and_tid_field: set_magic_and_tid_field,
    get_tid_field: get_tid_field,
    get_attrs_map: get_attrs_map,
    decode_attrs: decode_attrs,

    // UDP and TCP port
    PORT: 3478,
    // TLS port
    PORT_TLS: 5349,
    // packet header length
    HEADER_LENGTH: 20,
    // Binding type is the only stun method currently in use
    BINDING_TYPE: 0x0001,
    // Constant stun magic key, defined by the protocol.
    MAGIC_KEY: 0x2112A442,
    // The key for XOR_MAPPED_ADDRESS includes magic key and transaction id
    XOR_KEY_OFFSET: 4,
    // ms between indications
    INDICATION_INTERVAL: 5000,
    INDICATION_JITTER: {
        min: 0.8,
        max: 1.2,
    },

    // Method
    METHOD_MASK: 0x0110,
    METHODS: {
        REQUEST: 0x0000,
        INDICATION: 0x0010,
        SUCCESS: 0x0100,
        ERROR: 0x0110
    },

    // Attributes
    ATTRS: {
        MAPPED_ADDRESS: 0x0001,
        RESPONSE_ADDRESS: 0x0002, // deprecated
        CHANGE_ADDRESS: 0x0003, // deprecated
        SOURCE_ADDRESS: 0x0004, // deprecated
        CHANGED_ADDRESS: 0x0005, // deprecated
        USERNAME: 0x0006,
        PASSWORD: 0x0007, // deprecated
        MESSAGE_INTEGRITY: 0x0008,
        ERROR_CODE: 0x0009,
        UNKNOWN_ATTRIBUTES: 0x000A,
        REFLECTED_FROM: 0x000B, // deprecated
        REALM: 0x0014,
        NONCE: 0x0015,
        XOR_MAPPED_ADDRESS: 0x0020,
        PRIORITY: 0x0024,
        USE_CANDIDATE: 0x0025,
        ICE_CONTROLLED: 0x0026,
        ICE_CONTROLLING: 0x0027,
        SOFTWARE: 0x8022,
        ALTERNATE_SERVER: 0x8023,
        FINGERPRINT: 0x8028
    },

    // Error code
    ERROR_CODE: {
        300: 'Try Alternate',
        400: 'Bad Request',
        401: 'Unauthorized',
        420: 'Unknown Attribute',
        438: 'Stale Nonce',
        487: 'Role Conflict',
        500: 'Server Error'
    },

    PUBLIC_SERVERS: _.map([
        //        'stun://52.28.108.6:3478', //NooBaa stun on EC2 (Frankfurt)
        'stun://stun.l.google.com:19302',
        'stun://stun1.l.google.com:19302',
        'stun://stun2.l.google.com:19302',
        'stun://stun3.l.google.com:19302',
        'stun://stun4.l.google.com:19302',
        // 'stun://stun.ekiga.net',
        // 'stun://stun.ideasip.com',
        // 'stun://stun.iptel.org',
        // 'stun://stun.rixtelecom.se',
        // 'stun://stun.schlund.de',
        // 'stun://stunserver.org',
        // 'stun://stun.softjoys.com',
        // 'stun://stun.voiparound.com',
        // 'stun://stun.voipbuster.com',
        // 'stun://stun.voipstunt.com',
        // 'stun://stun.voxgratia.org',
        // 'stun://stun.xten.com',
    ], url.parse)
};
stun.METHOD_NAMES = _.invert(stun.METHODS);
stun.ATTR_NAMES = _.invert(stun.ATTRS);

module.exports = stun;

_.each(stun.PUBLIC_SERVERS, function(stun_url) {
    if (!stun_url.port) {
        stun_url.port =
            stun_url.protocol === 'stuns:' ?
            stun.PORT_TLS :
            stun.PORT;
    }
});



/**
 * detect stun packet according to header first byte
 */
function is_stun_packet(buffer) {
    var block = buffer.readUInt8(0);
    var bit1 = block & 0x80;
    var bit2 = block & 0x40;
    return bit1 === 0 && bit2 === 0;
}

/**
 * create and initialize a new stun packet buffer
 */
function new_packet(method_code, attrs, req_buffer) {
    var attrs_len = attrs ? encoded_attrs_len(attrs) : 0;
    var buffer = Buffer.alloc(stun.HEADER_LENGTH + attrs_len);
    set_method_field(buffer, method_code);
    set_attrs_len_field(buffer, attrs_len);
    set_magic_and_tid_field(buffer, req_buffer);
    if (attrs) {
        encode_attrs(buffer, attrs);
    }
    return buffer;
}

/**
 * decode the stun method field
 */
function get_method_field(buffer) {
    return buffer.readUInt16BE(0) & stun.METHOD_MASK;
}

/**
 * decode the stun method field
 */
function get_method_name(buffer) {
    var code = get_method_field(buffer);
    return stun.METHOD_NAMES[code];
}

/**
 * encode and set the stun method field
 * set binding class which is the only option for stun.
 */
function set_method_field(buffer, method_code) {
    var val = stun.BINDING_TYPE | (method_code & stun.METHOD_MASK);
    buffer.writeUInt16BE(val, 0);
}

/**
 * encode and set the stun method field
 */
function set_method_name(buffer, method_name) {
    method_name = method_name.toUpperCase();
    if (!(method_name in stun.METHODS)) {
        throw new Error('bad stun method');
    }
    var method_code = stun.METHODS[method_name];
    set_method_field(buffer, method_code);
}

/**
 * decode the stun attributes bytes length field
 */
function get_attrs_len_field(buffer) {
    return buffer.readUInt16BE(2);
}

/**
 * encode and set the stun attributes bytes length field
 */
function set_attrs_len_field(buffer, len) {
    buffer.writeUInt16BE(len, 2);
}

/**
 * set constant magic key and generate random tid
 */
function set_magic_and_tid_field(buffer, req_buffer) {
    // magic key is a constant
    buffer.writeUInt32BE(stun.MAGIC_KEY, 4);

    // 96bit transaction id
    if (req_buffer) {
        // copy tid from request
        req_buffer.copy(buffer, 8, 8, 20);
    } else {
        // generate new random tid
        crypto.pseudoRandomBytes(12).copy(buffer, 8);
    }
}

function get_tid_field(buffer) {
    return buffer.slice(8, 12);
}

/**
 * simply create a map from common attributes.
 * dup keys will be overriden by last value.
 */
function get_attrs_map(buffer) {
    var attrs = decode_attrs(buffer);
    var map = {};
    _.each(attrs, function(attr) {
        switch (attr.type) {
            case stun.ATTRS.XOR_MAPPED_ADDRESS:
            case stun.ATTRS.MAPPED_ADDRESS:
                map.address = attr.value;
                break;
            case stun.ATTRS.USERNAME:
                map.username = attr.value;
                break;
            case stun.ATTRS.PASSWORD:
                map.password = attr.value;
                break;
            case stun.ATTRS.USE_CANDIDATE:
                map.use_candidate = attr.value;
                break;
            case stun.ATTRS.ICE_CONTROLLED:
                map.ice_controlled = attr.value;
                break;
            case stun.ATTRS.ICE_CONTROLLING:
                map.ice_controlling = attr.value;
                break;
            default:
                break;
        }
    });
    return map;
}


/**
 * decode packet attributes
 */
function decode_attrs(buffer) {

    // limit the amount of work we are willing to do
    // in case someone decides to annoy us or just a bug
    if (buffer.length > 512) {
        throw new Error('STUN PACKET TOO LONG, dropping buffer ' + buffer.length);
    }

    var attrs = [];
    var offset = stun.HEADER_LENGTH;
    var end = offset + get_attrs_len_field(buffer);

    while (offset < end) {

        // limit the amount of work we are willing to do
        // in case someone decides to annoy us or just a bug
        if (attrs.length > 10) {
            throw new Error('STUN PACKET TOO MANY ATTRS dropping buffer ' + buffer.length);
        }

        var type = buffer.readUInt16BE(offset);
        offset += 2;
        var length = buffer.readUInt16BE(offset);
        offset += 2;

        if (length > 256) {
            throw new Error('STUN PACKET ATTR TOO LONG type=' + type +
                ' length=' + length + ' dropping buffer ' + buffer.length);
        }

        var next = offset + length;
        var value;
        switch (type) {
            case stun.ATTRS.MAPPED_ADDRESS:
            case stun.ATTRS.RESPONSE_ADDRESS:
            case stun.ATTRS.CHANGE_ADDRESS:
            case stun.ATTRS.SOURCE_ADDRESS:
            case stun.ATTRS.CHANGED_ADDRESS:
                value = decode_attr_mapped_addr(buffer, offset, next);
                break;
            case stun.ATTRS.XOR_MAPPED_ADDRESS:
                value = decode_attr_xor_mapped_addr(buffer, offset, next);
                break;
            case stun.ATTRS.ERROR_CODE:
                value = decode_attr_error_code(buffer, offset, next);
                break;
            case stun.ATTRS.UNKNOWN_ATTRIBUTES:
                value = decode_attr_unknown_attr(buffer, offset, next);
                break;
            case stun.ATTRS.SOFTWARE:
            case stun.ATTRS.USERNAME:
            case stun.ATTRS.PASSWORD:
            case stun.ATTRS.USE_CANDIDATE:
            case stun.ATTRS.ICE_CONTROLLED:
            case stun.ATTRS.ICE_CONTROLLING:
            case stun.ATTRS.REALM:
                value = buffer.slice(offset, next).toString('utf8');
                break;
            default:
                value = buffer.slice(offset, next);
                break;
        }

        attrs.push({
            attr: stun.ATTR_NAMES[type],
            value: value,
            type: type,
            length: length,
        });

        offset = align_offset(next);
    }

    return attrs;
}

/**
 *
 */
function encoded_attrs_len(attrs) {
    var len = 0;
    for (var i = 0; i < attrs.length; ++i) {
        if (!attrs[i]) continue;
        // every attr requires type and len 16bit each
        len = align_offset(len + 4 + encoded_attr_len(attrs[i]));
    }
    return len;
}

/**
 *
 */
function encoded_attr_len(attr) {
    switch (attr.type) {
        case stun.ATTRS.MAPPED_ADDRESS:
        case stun.ATTRS.RESPONSE_ADDRESS:
        case stun.ATTRS.CHANGE_ADDRESS:
        case stun.ATTRS.SOURCE_ADDRESS:
        case stun.ATTRS.CHANGED_ADDRESS:
        case stun.ATTRS.XOR_MAPPED_ADDRESS:
            // IPv4 address has: 2 byte family, 2 byte port, 4 byte ip
            // IPv6 address has: 2 byte family, 2 byte port, 8 byte ip
            return attr.value.family === 'IPv6' ? 12 : 8;
        case stun.ATTRS.SOFTWARE:
        case stun.ATTRS.USERNAME:
        case stun.ATTRS.PASSWORD:
        case stun.ATTRS.USE_CANDIDATE:
        case stun.ATTRS.ICE_CONTROLLED:
        case stun.ATTRS.ICE_CONTROLLING:
        case stun.ATTRS.REALM:
            return Buffer.byteLength(attr.value, 'utf8');
        default:
            return attr.value.length;
    }
}

/**
 *
 */
function encode_attrs(buffer, attrs) {
    var offset = stun.HEADER_LENGTH;
    for (var i = 0; i < attrs.length; ++i) {
        var attr = attrs[i];
        if (!attr) continue;
        buffer.writeUInt16BE(attr.type, offset);
        offset += 2;
        var length = encoded_attr_len(attr);
        buffer.writeUInt16BE(length, offset);
        offset += 2;
        var next = offset + length;

        switch (attr.type) {
            case stun.ATTRS.MAPPED_ADDRESS:
            case stun.ATTRS.RESPONSE_ADDRESS:
            case stun.ATTRS.CHANGE_ADDRESS:
            case stun.ATTRS.SOURCE_ADDRESS:
            case stun.ATTRS.CHANGED_ADDRESS:
                encode_attr_mapped_addr(attr.value, buffer, offset, next);
                break;
            case stun.ATTRS.XOR_MAPPED_ADDRESS:
                encode_attr_xor_mapped_addr(attr.value, buffer, offset, next);
                break;
            case stun.ATTRS.ERROR_CODE:
                encode_attr_error_code(attr.value, buffer, offset, next);
                break;
            case stun.ATTRS.SOFTWARE:
            case stun.ATTRS.USERNAME:
            case stun.ATTRS.PASSWORD:
            case stun.ATTRS.USE_CANDIDATE:
            case stun.ATTRS.ICE_CONTROLLED:
            case stun.ATTRS.ICE_CONTROLLING:
            case stun.ATTRS.REALM:
                buffer.write(attr.value, offset, length, 'utf8');
                break;
            default:
                throw new Error('ENCODE ATTR NOT SUPPORTED ' + attr.type);
        }

        offset = align_offset(next);
    }

}


/**
 * decode MAPPED-ADDRESS attribute
 * this is the main reply to stun request,
 * though XOR-MAPPED-ADDRESS is preferred to avoid routers messing with it
 */
function decode_attr_mapped_addr(buffer, start, end) {
    var family = (buffer.readUInt16BE(start) === 0x02) ? 6 : 4;
    var port = buffer.readUInt16BE(start + 2);
    var address = ip_module.toString(buffer, start + 4, family);

    return {
        family: 'IPv' + family,
        port: port,
        address: address
    };
}

/**
 * decode XOR-MAPPED-ADDRESS attribute
 * this is the main reply to stun request.
 */
function decode_attr_xor_mapped_addr(buffer, start, end) {
    var family = (buffer.readUInt16BE(start) === 0x02) ? 6 : 4;

    // xor the port against the magic key
    var port = buffer.readUInt16BE(start + 2) ^
        buffer.readUInt16BE(stun.XOR_KEY_OFFSET);

    // xor the address against magic key and tid
    var addr_buf = buffer.slice(start + 4, end);
    var xor_buf = Buffer.allocUnsafe(addr_buf.length);
    var k = stun.XOR_KEY_OFFSET;
    for (var i = 0; i < xor_buf.length; ++i) {
        xor_buf[i] = addr_buf[i] ^ buffer[k];
        k += 1;
    }
    var address = ip_module.toString(xor_buf, 0, family);

    return {
        family: 'IPv' + family,
        port: port,
        address: address
    };
}

/**
 * decode ERROR-CODE attribute
 */
function decode_attr_error_code(buffer, start, end) {
    var block = buffer.readUInt32BE(start);
    var code = ((block & 0x700) * 100) + block & 0xff;
    var reason = buffer.readUInt32BE(start + 4);
    return {
        code: code,
        reason: reason
    };
}

/**
 * decode UNKNOWN-ATTRIBUTES attribute
 */
function decode_attr_unknown_attr(buffer, start, end) {
    var unknown_attrs = [];
    var offset = start;
    while (offset < end) {
        unknown_attrs.push(buffer.readUInt16BE(offset));
        offset += 2;
    }
    return unknown_attrs;
}


/**
 * encode MAPPED-ADDRESS attribute
 * this is the main reply to stun request,
 * though XOR-MAPPED-ADDRESS is preferred to avoid routers messing with it
 */
function encode_attr_mapped_addr(addr, buffer, offset, end) {
    buffer.writeUInt16BE(addr.family === 'IPv6' ? 0x02 : 0x01, offset);

    // xor the port against the magic key
    buffer.writeUInt16BE(addr.port, offset + 2);

    ip_module.toBuffer(addr.address, buffer, offset + 4);
}


/**
 * encode XOR-MAPPED-ADDRESS attribute
 * this is the main reply to stun request.
 */
function encode_attr_xor_mapped_addr(addr, buffer, offset, end) {
    buffer.writeUInt16BE(addr.family === 'IPv6' ? 0x02 : 0x01, offset);

    // xor the port against the magic key
    buffer.writeUInt16BE(addr.port ^ buffer.readUInt16BE(stun.XOR_KEY_OFFSET), offset + 2);

    ip_module.toBuffer(addr.address, buffer, offset + 4);
    var k = stun.XOR_KEY_OFFSET;
    for (var i = offset + 4; i < end; ++i) {
        buffer[i] ^= buffer[k];
        k += 1;
    }
}


/**
 * encode ERROR-CODE attribute
 */
function encode_attr_error_code(err, buffer, start, end) {
    // eslint-disable-next-line no-bitwise
    var code = (((err.code / 100) | 0) << 8) | ((err.code % 100) & 0xff);
    buffer.writeUInt32BE(code, start);
    buffer.writeUInt32BE(err.reason, start + 4);
}


/**
 * offsets are aligned up to 4 bytes
 */
function align_offset(offset) {
    var rem = offset % 4;
    if (rem) {
        return offset + 4 - rem;
    } else {
        return offset;
    }
}

/**
 *
 */
function test() {
    var argv = require('minimist')(process.argv); // eslint-disable-line global-require
    var socket = dgram.createSocket('udp4');
    var stun_url = stun.PUBLIC_SERVERS[0];
    if (argv.stun_host) {
        stun_url = {
            hostname: argv.stun_host,
            port: argv.stun_port || stun.PORT
        };
    }
    socket.on('listening', function() {
        console.log('MY SOCKET ADDRESS', socket.address());
    });
    socket.on('message', function(buffer, rinfo) {
        if (!is_stun_packet(buffer)) {
            console.log('NON STUN MESSAGE', buffer.toString(), 'from', rinfo);
            return;
        }
        console.log('STUN', get_method_name(buffer), 'from', rinfo.address + ':' + rinfo.port);
        var attrs = decode_attrs(buffer);
        _.each(attrs, function(attr) {
            console.log('  *',
                attr.attr,
                '0x' + attr.type.toString(16),
                '[len ' + attr.length + ']',
                util.inspect(attr.value, { depth: null }));
        });
        var method = get_method_field(buffer);
        if (method === stun.METHODS.REQUEST) {
            var reply = new_packet(stun.METHODS.SUCCESS, [{
                type: stun.ATTRS.XOR_MAPPED_ADDRESS,
                value: {
                    family: 'IPv4',
                    port: rinfo.port,
                    address: rinfo.address
                }
            }], buffer);
            P.ninvoke(socket, 'send', reply, 0, reply.length, rinfo.port, rinfo.address);
        }
    });
    P.fcall(function() {
            if (argv.bind) {
                return P.ninvoke(socket, 'bind', argv.bind);
            }
        })
        .then(function() {
            var req = new_packet(stun.METHODS.REQUEST);
            var ind = new_packet(stun.METHODS.INDICATION);
            return loop();

            function loop() {
                if (argv.random) {
                    stun_url = chance.pick(stun.PUBLIC_SERVERS);
                }
                return Promise.all([
                        P.ninvoke(socket, 'send', req, 0, req.length, stun_url.port, stun_url.hostname),
                        P.ninvoke(socket, 'send', ind, 0, ind.length, stun_url.port, stun_url.hostname)])
                    .then(() => P.delay(stun.INDICATION_INTERVAL * chance.floating(stun.INDICATION_JITTER)))
                    .then(loop);
            }
        });
}

if (require.main === module) {
    test();
}
