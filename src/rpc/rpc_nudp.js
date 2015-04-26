'use strict';

// var _ = require('lodash');
var Q = require('q');
// var util = require('util');
// var buffer_utils = require('../util/buffer_utils');
var LinkedList = require('noobaa-util/linked_list');
var dbg = require('noobaa-util/debug_module')(__filename);
var dgram = require('dgram');
var chance = require('chance');

module.exports = {
    reusable: true,
    connect: connect,
    authenticate: authenticate,
    send: send,
    close: close,
    listen: listen,
};

var PACKET_MAGIC = 0xFEEDF33D;
var CURRENT_VERSION = 1;
var PACKET_TYPE_DATA = 1;
var PACKET_TYPE_ACK = 2;
var PACKET_FLAG_BOUNDARY_END = 1 << 0;
var PACKET_HEADER_LEN = 32;
var STATE_CONNECTED = 'connected';
var STATE_CLOSED = 'closed';
var UINT32_MAX = (1 << 16) * (1 << 16) - 1;
var CONN_RAND_CHANCE = {
    min: 0,
    max: UINT32_MAX
};
var MTU_MIN = 576;
var MTU_MAX = 64 * 1024;
var WINDOW_BYTES = 1024 * 1024;
var WINDOW_LENGTH = 1000;
var SEND_DELAY_MAX = 1000;
var SEND_DELAY_THRESHOLD = 100;
var BATCH_BYTES = 128 * 1024;
var ACK_DELAY = 10;

/**
 *
 * connect
 *
 */
function connect(conn) {
    var nudp_host = conn.rpc.nudp_host;
    if (!nudp_host) {
        throw new Error('NUDP not listening');
    }
    var existing = nudp_host.connections[conn.address];
    if (existing) {
        if (existing !== conn) {
            throw new Error('NUDP host already connected ' + conn.address);
        } else {
            return;
        }
    }
    nudp_host.connections[conn.address] = conn;

    conn.nudp = {
        state: STATE_CONNECTED,

        // each connection keeps timestamp + random that are taken at connect time
        // which are used to identify this connection by both ends, and react in case
        // one of the sides crashes and the connection is dropped without communicating.
        // in such case all pending requests will need to be rejected
        // and retried on new connection.
        time: Date.now(),
        rand: chance.integer(CONN_RAND_CHANCE),

        // the message send queue is the first phase for sending messages,
        // and its main purpose is to maintain the buffer message boundary,
        // and a Q.defer used to wakeup the caller once acknowledged.
        message_send_queue: new LinkedList('msq'),
        message_send_bytes: 0,

        // the send & receive windows holding packet objects which are being
        // transmitted over the connection, and will be marked and removed
        // when the acknowledge is received.
        packet_send_by_seq: {},
        packet_send_pending: new LinkedList('psp'),
        packet_send_win: new LinkedList('psw'),
        packet_send_win_bytes: 0,
        packet_send_win_seq: 1,
        packet_recv_by_seq: {},
        packet_recv_win_bytes: 0,
        packet_recv_win_seq: 1,
        packet_recv_msg: [],
        packet_recv_msg_len: 0,
        ack_queue: new LinkedList('ack'),

        mtu_min: MTU_MIN,
        mtu_max: MTU_MAX,
        mtu_last: 0,

        send_callback: function(err, bytes) {
            if (err) {
                conn.emit('error', err);
            }
        }
    };

    // TODO nudp connection keepalive interval

}


/**
 *
 * authenticate
 *
 */
function authenticate(conn, auth_token) {
    // TODO for now just save auth_token and send with every message, better send once
}

/**
 *
 * send
 *
 */
function send(conn, buffer, op, req) {
    var defer = Q.defer();
    if (!buffer || !buffer.length) {
        throw new Error('cannot send empty message');
    }
    conn.nudp.message_send_queue.push_back({
        defer: defer,
        conn: conn,
        buffer: buffer,
        offset: 0,
    });
    process_send_queue(conn);
    return defer.promise;
}


/**
 *
 * close
 *
 */
function close(conn) {
    conn.nudp.state = STATE_CLOSED;
    delete conn.rpc.nudp_host.connections[conn.address];
}


/**
 *
 * listen
 *
 */
function listen(rpc, port) {
    if (rpc.nudp_host) {
        throw new Error('NUDP already listening');
    }
    var nudp_host = {
        port: port,
        socket: dgram.createSocket('udp4'),
        connections: {}
    };
    nudp_host.socket.on('message', function(buffer, rinfo) {
        var address = 'nudp://' + rinfo.address + ':' + rinfo.port;
        var conn = nudp_host.connections[address];
        if (!conn) {
            conn = nudp_host.connections[address] =
                rpc.new_connection(address);
        }
        handle_packet(buffer, conn);
    });
    nudp_host.socket.on('close', function() {
        // TODO can udp sockets just close?
        dbg.error('NUDP socket closed');
    });
    nudp_host.socket.on('error', function(err) {
        // TODO can udp sockets just error?
        dbg.error('NUDP socket error', err.stack || err);
    });
    rpc.nudp_host = nudp_host;
    return Q.ninvoke(nudp_host.socket, 'bind', port);
}



///////////////////////////////////////////////////////////////////////////////


function process_send_queue(conn) {
    var nu = conn.nudp;
    if (!nu || nu.state !== STATE_CONNECTED) {
        throw new Error('NUDP not connected');
        // TODO maybe better to emit connection error instead of throwing?
    }

    trim_send_window(conn);
    fill_send_window(conn);
    var next_schedule = send_next_packets(conn);

    clearTimeout(nu.process_send_timeout);
    nu.process_send_timeout =
        setTimeout(process_send_queue, next_schedule, conn);
}

/**
 *
 * trim_send_window
 *
 * "trim left" acknowledged packets from the window
 *
 */
function trim_send_window(conn) {
    var nu = conn.nudp;
    var packet = nu.packet_send_win.front();
    while (packet && packet.ack) {
        nu.packet_send_win.pop_front();
        packet = nu.packet_send_win.front();
    }
}

/**
 *
 * fill_send_window
 *
 * fill the send window from the message send queue.
 * this is bit heavy work of cpu/memory due to buffer copying.
 *
 */
function fill_send_window(conn) {
    var nu = conn.nudp;
    while (nu.packet_send_win_bytes < WINDOW_BYTES &&
        nu.packet_send_win.length < WINDOW_LENGTH) {
        var message = nu.message_send_queue.front();
        if (!message) {
            break;
        }
        var buf = new Buffer(nu.mtu_last || nu.mtu_max);
        var packet_remain = buf.length - PACKET_HEADER_LEN;
        var message_remain = message.buffer.length - message.offset;
        var payload_len = Math.min(packet_remain, message_remain);
        var packet_len = PACKET_HEADER_LEN + payload_len;
        var flags = 0;
        if (packet_remain >= message_remain) {
            flags |= PACKET_FLAG_BOUNDARY_END;
        }
        var seq = nu.packet_send_win_seq;
        var packet = {
            seq: seq,
            buffer: buf,
            len: packet_len,
            transmits: 0,
            last_sent: 0,
        };
        write_packet_header(buf, nu.time, nu.rand, seq, flags);
        message.buffer.copy(
            buf, PACKET_HEADER_LEN,
            message.offset, message.offset + payload_len);
        message.offset += payload_len;
        if (message.offset >= message.buffer.length) {
            nu.message_send_queue.pop_front();
        }
        nu.packet_send_by_seq[seq] = packet;
        nu.packet_send_pending.push_back(packet);
        nu.packet_send_win.push_back(packet);
        nu.packet_send_win_seq += 1;
        nu.packet_send_win_bytes += packet_len;
    }
}

/**
 *
 * send_next_packets
 *
 */
function send_next_packets(conn) {
    var nu = conn.nudp;
    var socket = conn.rpc.nudp.socket;
    var now = Date.now();
    var batch = 0;
    var next_schedule = SEND_DELAY_MAX;
    var last = nu.packet_send_pending.back();
    while (batch < BATCH_BYTES && nu.packet_send_pending.length) {
        var packet = nu.packet_send_pending.pop_front();
        nu.packet_send_pending.push_back(packet);
        // send packets if haven't been sent for 100 ms
        if (now - packet.last_sent > SEND_DELAY_THRESHOLD) {
            packet.transmits += 1;
            packet.last_sent = now;
            batch += packet.len;
            socket.send(
                packet.buffer, 0, packet.len,
                conn.url.port, conn.url.hostname,
                nu.send_callback);
        } else {
            next_schedule = Math.min(next_schedule, now - packet.last_sent);
        }
        // stop once completed cycle on all packets
        if (packet === last) {
            break;
        }
    }
    return next_schedule;
}


/**
 * handle_packet
 */
function handle_packet(buffer, conn) {
    var hdr = read_packet_header(buffer);
    switch (hdr.type) {
        case PACKET_TYPE_DATA:
            handle_data_packet(hdr, buffer, conn);
            break;
        case PACKET_TYPE_ACK:
            handle_ack_packet(hdr, buffer, conn);
            break;
        default:
            break;
    }
}

function handle_data_packet(hdr, buffer, conn) {
    var nu = conn.nudp;
    var packet = {
        hdr: hdr,
        payload: buffer.slice(PACKET_HEADER_LEN)
    };
    if (hdr.seq !== nu.packet_recv_win_seq) {
        nu.packet_recv_by_seq[hdr.seq] = packet;
    } else {
        while (packet) {
            nu.packet_recv_msg.push(packet.payload);
            nu.packet_recv_msg_len += packet.payload.length;
            nu.packet_recv_win_seq += 1;
            if (packet.hdr.flags & PACKET_FLAG_BOUNDARY_END) {
                var msg = Buffer.concat(nu.packet_recv_msg, nu.packet_recv_msg_len);
                nu.packet_recv_msg.length = 0;
                nu.packet_recv_msg_len = 0;
                conn.receive(msg);
            }
            packet = nu.packet_recv_by_seq[nu.packet_recv_win_seq];
            delete nu.packet_recv_by_seq[nu.packet_recv_win_seq];
        }
    }
    nu.ack_queue.push_back(hdr);
    if (!nu.ack_timeout) {
        nu.ack_timeout = setTimeout(send_acks, ACK_DELAY, conn);
    }
}

function handle_ack_packet(hdr, buffer, conn) {
    var nu = conn.nudp;
    var offset = PACKET_HEADER_LEN;

    // hdr.seq is sent as number of sequences that are encoded in the payload
    for (var i = 0; i < hdr.seq; ++i) {
        var seq = buffer.readDoubleBE(offset);
        offset += 8;
        var packet = nu.packet_send_by_seq[seq];
        if (packet) {
            packet.ack = true;
            nu.packet_send_pending.remove(packet);
            nu.packet_send_win_bytes -= packet.len;
        } else {
            dbg.log0('ACK ignored', seq);
        }
        delete nu.packet_send_by_seq[seq];
    }

    process_send_queue(conn);
}

function send_acks(conn) {
    var nu = conn.nudp;
    while (nu.ack_queue.length) {
        var buf = new Buffer(nu.mtu_last || nu.mtu_max);
        var count = 0;
        var offset = PACKET_HEADER_LEN;
        while (offset < buf.length && nu.ack_queue.length) {
            var hdr = nu.ack_queue.pop_front();
            buf.writeDoubleBE(hdr.seq, offset);
            offset += 8;
            count += 1;
        }
        write_packet_header(buf, nu.time, nu.rand, count, 0);
        conn.rpc.nudp_host.socket.send(
            buf, 0, offset,
            conn.url.port, conn.url.hostname,
            nu.send_callback);
    }
}

function write_packet_header(buf, time, rand, seq, flags) {
    buf.writeUInt32BE(PACKET_MAGIC, 0);
    buf.writeUInt16BE(CURRENT_VERSION, 4);
    buf.writeUInt16BE(PACKET_TYPE_DATA, 6);
    buf.writeDoubleBE(time, 8);
    buf.writeUInt32BE(rand, 16);
    buf.writeDoubleBE(seq, 20);
    buf.writeUInt32BE(flags, 28);
}

function read_packet_header(buf) {
    var magic = buf.readUInt32BE(0);
    if (magic !== PACKET_MAGIC) {
        throw new Error('BAD PACKET MAGIC ' + magic);
    }
    var version = buf.readUInt16BE(4);
    if (version !== CURRENT_VERSION) {
        throw new Error('BAD PACKET VERSION ' + version);
    }
    var type = buf.readUInt16BE(6);
    var time = buf.readDoubleBE(8);
    var rand = buf.readUInt32BE(16);
    var seq = buf.readDoubleBE(20);
    var flags = buf.readUInt32BE(28);
    return {
        type: type,
        time: time,
        rand: rand,
        seq: seq,
        flags: flags,
    };
}
