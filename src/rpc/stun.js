'use strict';

var _ = require('lodash');
var Q = require('q');
var ip = require('ip');
var url = require('url');
var util = require('util');
var dgram = require('dgram');
var crypto = require('crypto');
var dbg = require('noobaa-util/debug_module')(__filename);

// https://tools.ietf.org/html/rfc5389
var STUN = {

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
    INDICATION_INTERVAL: 10000,

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
        RESPONSE_ADDRESS_OLD: 0x0002,
        CHANGE_ADDRESS_OLD: 0x0003,
        SOURCE_ADDRESS_OLD: 0x0004,
        CHANGED_ADDRESS_OLD: 0x0005,
        USERNAME: 0x0006,
        PASSWORD_OLD: 0x0007,
        MESSAGE_INTEGRITY: 0x0008,
        ERROR_CODE: 0x0009,
        UNKNOWN_ATTRIBUTES: 0x000A,
        REFLECTED_FROM_OLD: 0x000B,
        REALM: 0x0014,
        NONCE: 0x0015,
        XOR_MAPPED_ADDRESS: 0x0020,
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
        500: 'Server Error'
    },

    PUBLIC_SERVERS: _.map([
        'stun://stun.l.google.com:19302',
        'stun://stun1.l.google.com:19302',
        'stun://stun2.l.google.com:19302',
        'stun://stun3.l.google.com:19302',
        'stun://stun4.l.google.com:19302',
        'stun://stun.ekiga.net',
        'stun://stun.ideasip.com',
        'stun://stun.iptel.org',
        'stun://stun.rixtelecom.se',
        'stun://stun.schlund.de',
        'stun://stunserver.org',
        'stun://stun.softjoys.com',
        'stun://stun.voiparound.com',
        'stun://stun.voipbuster.com',
        'stun://stun.voipstunt.com',
        'stun://stun.voxgratia.org',
        'stun://stun.xten.com',
    ], url.parse)
};
STUN.METHOD_NAMES = _.invert(STUN.METHODS);
STUN.ATTR_NAMES = _.invert(STUN.ATTRS);
_.each(STUN.PUBLIC_SERVERS, function(stun_url) {
    if (!stun_url.port) {
        stun_url.port =
            stun_url.protocol === 'stuns:' ?
            STUN.PORT_TLS :
            STUN.PORT;
    }
});

module.exports = {
    STUN: STUN,
    connect_socket: connect_socket,
    send_request: send_request,
    send_indication: send_indication,
    is_stun_packet: is_stun_packet,
    new_packet: new_packet,
    get_method: get_method,
    get_method_name: get_method_name,
    set_method: set_method,
    set_method_name: set_method_name,
    get_attrs_len: get_attrs_len,
    set_attrs_len: set_attrs_len,
    decode_attrs: decode_attrs,
    test: test,
};


/**
 *
 */
function connect_socket(socket, stun_host, stun_port) {
    var interval;

    socket.on('close', function() {
        clearInterval(interval);
        interval = null;
    });

    // other handlers of the 'message' event need to filter out stun messages
    // using is_stun_packet check since stun is multiplexed on the same data
    // socket, and therefore data messages need to have a first byte that looks
    // different than stun.
    socket.on('message', function(buffer, rinfo) {
        if (!is_stun_packet(buffer)) {
            return;
        }
        var method = get_method(buffer);
        switch (method) {
            case STUN.METHODS.REQUEST:
                receive_stun_request(socket, buffer, rinfo);
                break;
            case STUN.METHODS.SUCCESS:
                receive_stun_response(socket, buffer, rinfo);
                break;
            case STUN.METHODS.INDICATION:
                socket.emit('stun.indication', rinfo);
                break;
            case STUN.METHODS.ERROR:
                socket.emit('stun.error', rinfo);
                break;
            default:
                break;
        }
    });

    return send_request(socket, stun_host, stun_port)
        .then(function() {
            interval = setInterval(
                send_indication,
                STUN.INDICATION_INTERVAL,
                socket,
                stun_host,
                stun_port);
        });

}


/**
 *
 */
function receive_stun_request(socket, buffer, rinfo) {
    dbg.log0('STUN REQUEST', rinfo.address + ':' + rinfo.port);
    // TODO reply stun packet with xor address of rinfo
}

/**
 *
 */
function receive_stun_response(socket, buffer, rinfo) {
    var attrs = decode_attrs(buffer);
    _.each(attrs, function(attr) {
        // if we have an address then emit to the socket
        if (attr.type === STUN.ATTRS.XOR_MAPPED_ADDRESS ||
            attr.type === STUN.ATTRS.MAPPED_ADDRESS) {
            socket.emit('stun.address', attr.value);
        }
    });
}


/**
 * send stun request.
 * the stun server should send a reply on this socket.
 */
function send_request(socket, stun_host, stun_port) {
    var buffer = new_packet('request');
    return Q.ninvoke(socket, 'send',
        buffer, 0, buffer.length,
        stun_port, stun_host);
}

/**
 * send stun indication.
 * this is essentialy a keep alive that does not require reply from the stun server.
 */
function send_indication(socket, stun_host, stun_port) {
    var buffer = new_packet('indication');
    return Q.ninvoke(socket, 'send',
        buffer, 0, buffer.length,
        stun_port || STUN.PORT, stun_host);
}

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
function new_packet(method_name) {
    var buffer = new Buffer(STUN.HEADER_LENGTH);

    // set binding class which is the only option for stun,
    // and default method is a new stun request
    buffer.writeUInt16BE(STUN.BINDING_TYPE | STUN.METHODS.REQUEST, 0);

    // attrs len - init to 0
    buffer.writeUInt16BE(0, 2);

    // magic key is a constant
    buffer.writeUInt32BE(STUN.MAGIC_KEY, 4);

    // 96bit transaction id
    crypto.pseudoRandomBytes(12).copy(buffer, 8);

    if (method_name) {
        set_method_name(buffer, method_name);
    }

    return buffer;
}

/**
 * decode the stun method field
 */
function get_method(buffer) {
    return buffer.readUInt16BE(0) & STUN.METHOD_MASK;
}

/**
 * decode the stun method field
 */
function get_method_name(buffer) {
    var code = get_method(buffer);
    return STUN.METHOD_NAMES[code];
}

/**
 * encode and set the stun method field
 */
function set_method(buffer, method_code) {
    var val = STUN.BINDING_TYPE | method_code;
    buffer.writeUInt16BE(val, 0);
}

/**
 * encode and set the stun method field
 */
function set_method_name(buffer, method_name) {
    method_name = method_name.toUpperCase();
    if (!(method_name in STUN.METHODS)) {
        throw new Error('bad stun method');
    }
    var method_code = STUN.METHODS[method_name];
    set_method(buffer, method_code);
}

/**
 * decode the stun attributes bytes length field
 */
function get_attrs_len(buffer) {
    return buffer.readUInt16BE(2);
}

/**
 * encode and set the stun attributes bytes length field
 */
function set_attrs_len(buffer, len) {
    return buffer.readUInt16BE(len, 2);
}

/**
 * decode packet attributes
 */
function decode_attrs(buffer) {
    var attrs = [];
    var offset = STUN.HEADER_LENGTH;
    var end = offset + get_attrs_len(buffer);

    while (offset < end) {
        var type = buffer.readUInt16BE(offset);
        offset += 2;
        var length = buffer.readUInt16BE(offset);
        offset += 2;

        var next = offset + length;
        var value;
        switch (type) {
            case STUN.ATTRS.MAPPED_ADDRESS:
            case STUN.ATTRS.RESPONSE_ADDRESS_OLD:
            case STUN.ATTRS.CHANGE_ADDRESS_OLD:
            case STUN.ATTRS.SOURCE_ADDRESS_OLD:
            case STUN.ATTRS.CHANGED_ADDRESS_OLD:
                value = decode_attr_mapped_addr(buffer, offset, next);
                break;
            case STUN.ATTRS.XOR_MAPPED_ADDRESS:
                value = decode_attr_xor_mapped_addr(buffer, offset, next);
                break;
            case STUN.ATTRS.ERROR_CODE:
                value = decode_attr_error_code(buffer, offset, next);
                break;
            case STUN.ATTRS.UNKNOWN_ATTRIBUTES:
                value = decode_attr_unknown_attr(buffer, offset, next);
                break;
            case STUN.ATTRS.SOFTWARE:
            case STUN.ATTRS.USERNAME:
            case STUN.ATTRS.REALM:
                value = buffer.slice(offset, next).toString('ascii');
                break;
                /*
                case STUN.ATTRS.NONCE:
                case STUN.ATTRS.MESSAGE_INTEGRITY:
                case STUN.ATTRS.ALTERNATE_SERVER:
                case STUN.ATTRS.FINGERPRINT:
                case STUN.ATTRS.REFLECTED_FROM_OLD:
                case STUN.ATTRS.PASSWORD_OLD:
                */
            default:
                value = buffer.slice(offset, next);
                break;
        }

        attrs.push({
            attr: STUN.ATTR_NAMES[type],
            value: value,
            type: type,
            length: length,
        });

        // align offset to 4 bytes
        offset = next;
        var rem = offset % 4;
        offset += rem ? (4 - rem) : 0;
    }

    return attrs;
}

/**
 * decode MAPPED-ADDRESS attribute
 * this is the main reply to stun request,
 * though XOR-MAPPED-ADDRESS is preferred to avoid routers messing with it
 */
function decode_attr_mapped_addr(buffer, start, end) {
    var family = (buffer.readUInt16BE(start) === 0x02) ? 6 : 4;
    var port = buffer.readUInt16BE(start + 2);
    var address = ip.toString(buffer, start + 4, family);

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
        buffer.readUInt16BE(STUN.XOR_KEY_OFFSET);

    // xor the address against magic key and tid
    var addr_buf = buffer.slice(start + 4, end);
    var xor_buf = new Buffer(addr_buf.length);
    var k = STUN.XOR_KEY_OFFSET;
    for (var i = 0; i < xor_buf.length; ++i) {
        xor_buf[i] = addr_buf[i] ^ buffer[k++];
    }
    var address = ip.toString(xor_buf, 0, family);

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
    var code = (block & 0x700) * 100 + block & 0xff;
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
 *
 */
function test() {
    var socket = dgram.createSocket('udp4');
    socket.on('message', function(buffer, rinfo) {
        if (is_stun_packet(buffer)) {
            console.log('\nREPLY:', rinfo.address + ':' + rinfo.port,
                'method', get_method_name(buffer),
                'attrs len', get_attrs_len(buffer));
            var attrs = decode_attrs(buffer);
            _.each(attrs, function(attr) {
                console.log('  *',
                    attr.attr,
                    '0x' + attr.type.toString(16),
                    '[len ' + attr.length + ']',
                    util.inspect(attr.value, {
                        depth: null
                    }));
            });
        }
        // socket.close();
    });
    return Q.allSettled(_.map(STUN.PUBLIC_SERVERS, function(stun_url) {
            console.log('REQUEST:', stun_url.hostname + ':' + stun_url.port);
            return send_request(socket, stun_url.hostname, stun_url.port);
        }))
        .then(function() {
            console.log('SOCKET ADDRESS', socket.address());
            return socket;
        });
}

if (require.main === module) {
    test();
}
