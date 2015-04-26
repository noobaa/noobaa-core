'use strict';

// var _ = require('lodash');
var Q = require('q');
// var util = require('util');
// var buffer_utils = require('../util/buffer_utils');
var LinkedList = require('noobaa-util/linked_list');
var dbg = require('noobaa-util/debug_module')(__filename);
var dgram = require('dgram');
var chance = require('chance').Chance(Date.now());

module.exports = {
    reusable: true,
    connect: connect,
    authenticate: authenticate,
    send: send,
    close: close,
    listen: listen,
};

var STATE_INIT = 'init';
var STATE_CONNECTED = 'connected';
var STATE_CLOSED = 'closed';

var PACKET_HEADER_LEN = 32;
var PACKET_MAGIC = 0xFEEDF33D;
var CURRENT_VERSION = 1;
var PACKET_FLAG_BOUNDARY_END = 1 << 0;

var PACKET_TYPE_SYN = 1;
var PACKET_TYPE_SYN_ACK = 2;
var PACKET_TYPE_FIN = 3;
var PACKET_TYPE_DATA = 4;
var PACKET_TYPE_DATA_ACK = 5;

var UINT32_MAX = (1 << 16) * (1 << 16) - 1;
var MTU_DEFAULT = 1200;
var MTU_MIN = 576;
var MTU_MAX = 64 * 1024;

var WINDOW_BYTES_MAX = 8 * 1024 * 1024;
var WINDOW_LENGTH_MAX = 10000;

var SEND_DELAY_MAX = 1000;
var SEND_DELAY_THRESHOLD = 10;
var BATCH_BYTES = 512 * 1024;
var ACK_DELAY = 10;
var CONN_RAND_CHANCE = {
    min: 1,
    max: UINT32_MAX
};

/**
 *
 * connect
 *
 */
function connect(conn) {
    var nu = conn.nudp;
    if (nu) {
        if (nu.state === STATE_CONNECTED) {
            return;
        } else if (nu.connect_defer) {
            return nu.connect_defer.promise;
        } else {
            throw new Error('NUDP unexpected connection ' + nu.connid +
                ' state ' + nu.state);
        }
    }

    init_nudp_conn(conn);
    nu = conn.nudp;

    if (!nu.context) {
        throw new Error('NUDP no listening context');
    }
    nu.context.connections[nu.connid] = conn;

    // TODO nudp connection keepalive interval

    // send syn packet and wait for syn ack
    send_syn(conn);
    return nu.connect_defer.promise;
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
    var nu = conn.nudp;
    var defer = Q.defer();
    if (!buffer || !buffer.length) {
        throw new Error('cannot send empty message');
    }
    nu.message_send_queue.push_back({
        defer: defer,
        conn: conn,
        buffer: buffer,
        offset: 0,
        num_packets: 0,
        sent_packets: 0,
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
    var nu = conn.nudp;
    nu.state = STATE_CLOSED;
    var message = nu.message_send_queue.get_front();
    while (message) {
        message.defer.reject('connection closed');
        message = nu.message_send_queue.get_next(message);
    }
    delete nu.context.connections[nu.connid];
    if (nu.connect_defer) {
        nu.connect_defer.reject('connection closed');
        nu.connect_defer = null;
    }
}


/**
 *
 * listen
 *
 */
function listen(rpc, port) {
    if (rpc.nudp_context) {
        throw new Error('NUDP already listening');
    }
    var nudp_context = {
        port: port,
        socket: dgram.createSocket('udp4'),
        connections: {}
    };
    nudp_context.socket.on('message', receive_packet.bind(null, rpc, nudp_context));
    nudp_context.socket.on('close', function() {
        // TODO can udp sockets just close?
        dbg.error('NUDP socket closed');
    });
    nudp_context.socket.on('error', function(err) {
        // TODO can udp sockets just error?
        dbg.error('NUDP socket error', err.stack || err);
    });
    rpc.nudp_context = nudp_context;
    return Q.ninvoke(nudp_context.socket, 'bind', port);
}



///////////////////////////////////////////////////////////////////////////////


/**
 *
 * init_nudp_conn
 *
 */
function init_nudp_conn(conn, time, rand) {
    time = time || Date.now();
    rand = rand || chance.integer(CONN_RAND_CHANCE);

    var nu = conn.nudp = {
        context: conn.rpc.nudp_context,
        state: STATE_INIT,
        connect_defer: Q.defer(),
        send_packet: send_packet,

        // each connection keeps timestamp + random that are taken at connect time
        // which are used to identify this connection by both ends, and react in case
        // one of the sides crashes and the connection is dropped without communicating.
        // in such case all pending requests will need to be rejected
        // and retried on new connection.
        time: time,
        rand: rand,
        connid: conn.address +
            '/' + time.toString(16) +
            '.' + rand.toString(16),

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
        mtu: MTU_DEFAULT,
    };

    function send_packet(buf, offset, count) {
        nu.context.socket.send(
            buf,
            offset || 0,
            count || buf.length,
            conn.url.port,
            conn.url.hostname,
            send_callback);
    }

    function send_callback(err) {
        if (err) {
            conn.emit('error', err);
        }
    }
}


/**
 *
 * process_send_queue
 *
 */
function process_send_queue(conn) {
    var nu = conn.nudp;
    if (!nu || nu.state !== STATE_CONNECTED) {
        throw new Error('NUDP not connected');
        // TODO maybe better to emit connection error instead of throwing?
    }
    dbg.log2('process_send_queue', nu.connid);

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
    var packet = nu.packet_send_win.get_front();
    while (packet && packet.ack) {
        dbg.log2('trim_send_window', nu.connid, packet.seq);
        nu.packet_send_win.pop_front();
        packet = nu.packet_send_win.get_front();
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
    dbg.log2('fill_send_window', nu.connid,
        'start', nu.packet_send_win.length, nu.packet_send_win_bytes);
    while (nu.packet_send_win.length < WINDOW_LENGTH_MAX &&
        nu.packet_send_win_bytes < WINDOW_BYTES_MAX) {
        var message = nu.message_send_queue.get_front();
        if (!message) {
            break;
        }
        var buf = new Buffer(nu.mtu || nu.mtu_min);
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
            message: message
        };
        write_packet_header(buf, PACKET_TYPE_DATA, nu.time, nu.rand, seq, flags);
        message.buffer.copy(
            buf, PACKET_HEADER_LEN,
            message.offset, message.offset + payload_len);
        message.offset += payload_len;
        message.num_packets += 1;
        if (message.offset >= message.buffer.length) {
            nu.message_send_queue.pop_front();
        }
        nu.packet_send_by_seq[seq] = packet;
        nu.packet_send_pending.push_back(packet);
        nu.packet_send_win.push_back(packet);
        nu.packet_send_win_seq += 1;
        nu.packet_send_win_bytes += packet_len;
        dbg.log2('fill_send_window', nu.connid, packet.seq);
    }
}


/**
 *
 * send_next_packets
 *
 */
function send_next_packets(conn) {
    var nu = conn.nudp;
    var now = Date.now();
    var batch = 0;
    var min_threshold = SEND_DELAY_MAX;
    var last = nu.packet_send_pending.get_back();
    while (batch < BATCH_BYTES && nu.packet_send_pending.length) {
        var packet = nu.packet_send_pending.pop_front();
        nu.packet_send_pending.push_back(packet);
        dbg.log2('send_next_packets', nu.connid,
            'seq', packet.seq,
            'len', packet.len,
            'transmits', packet.transmits);
        // resend packets only if last send was above a threshold
        if (now - packet.last_sent > SEND_DELAY_THRESHOLD) {
            min_threshold = 0;
            packet.transmits += 1;
            packet.last_sent = now;
            batch += packet.len;
            dbg.log2('send_next_packets', nu.connid, 'send seq', packet.seq);
            nu.send_packet(packet.buffer, 0, packet.len);
            packet.message.sent_packets += 1;
            if (packet.message.offset >= packet.message.buffer.length &&
                packet.message.sent_packets === packet.message.num_packets) {
                packet.message.defer.resolve();
            }
        } else {
            min_threshold = Math.min(
                min_threshold,
                SEND_DELAY_THRESHOLD - now + packet.last_sent);
            dbg.log2('send_next_packets', nu.connid, 'min_threshold', min_threshold);
        }
        // stop once completed cycle on all packets
        if (packet === last) {
            break;
        }
    }
    return min_threshold < 0 ? 0 : min_threshold;
}


/**
 *
 * receive_packet
 *
 */
function receive_packet(rpc, nudp_context, buffer, rinfo) {
    var hdr = read_packet_header(buffer);
    var address = 'nudp://' + rinfo.address + ':' + rinfo.port;
    var connid = address +
        '/' + hdr.time.toString(16) +
        '.' + hdr.rand.toString(16);
    var conn = nudp_context.connections[connid];
    if (!conn) {
        dbg.log0('NUDP CONNECTION', connid);
        conn = nudp_context.connections[connid] =
            rpc.new_connection(address);
        init_nudp_conn(conn, hdr.time, hdr.rand);
    }
    var nu = conn.nudp;
    dbg.log2('receive_packet', nu.connid, 'type', hdr.type, 'seq', hdr.seq);
    switch (hdr.type) {
        case PACKET_TYPE_SYN:
            receive_syn(conn, hdr);
            break;
        case PACKET_TYPE_SYN_ACK:
            receive_syn_ack(conn, hdr);
            break;
        case PACKET_TYPE_FIN:
            receive_fin(conn, hdr);
            break;
        case PACKET_TYPE_DATA:
            receive_data_packet(conn, hdr, buffer);
            break;
        case PACKET_TYPE_DATA_ACK:
            receive_acks(conn, hdr, buffer);
            break;
        default:
            dbg.error('receive_packet', nu.connid, 'BAD PACKET TYPE', hdr);
            break;
    }
}


/**
 *
 * send_syn
 *
 */
function send_syn(conn) {
    var nu = conn.nudp;
    var syn_buf = new Buffer(PACKET_HEADER_LEN);
    var attempt = 0;
    var timer;
    next_attempt();

    function next_attempt() {
        attempt += 1;
        clearTimeout(timer);
        dbg.log0('send_syn', nu.connid, 'state', nu.state, 'attempt', attempt);

        // if state is not init we are done trying to SYN -
        // might be connected or closed already.
        if (nu.state !== STATE_INIT) {
            return;
        }

        // limit attempts
        if (attempt > 10) {
            conn.emit('error', new Error('connect exhuasted ' + nu.connid));
            return;
        }

        // send the SYN attempt sequence over the hdr.seq field
        write_packet_header(syn_buf, PACKET_TYPE_SYN, nu.time, nu.rand, attempt, 0);
        nu.send_packet(syn_buf);
        timer = setTimeout(next_attempt, 100);
    }
}

/**
 *
 * receive_syn
 *
 */
function receive_syn(conn, hdr) {
    var nu = conn.nudp;
    dbg.log0('receive_syn', nu.connid, 'state', nu.state, 'attempt', hdr.seq);
    if (nu.state === STATE_INIT) {
        nu.state = STATE_CONNECTED;
        if (nu.connect_defer) {
            nu.connect_defer.resolve();
            nu.connect_defer = null;
        }
    }

    // TODO if closed send FIN

    // for every SYN we accept we reply with SYN ACK
    // so even if the message is lost, the retries on send_syn will resolve.
    // reply back the SYN attempt sequence which is sent over the hdr.seq field.
    var syn_ack_buf = new Buffer(PACKET_HEADER_LEN);
    write_packet_header(syn_ack_buf, PACKET_TYPE_SYN_ACK, nu.time, nu.rand, hdr.seq, 0);
    nu.send_packet(syn_ack_buf);
}



/**
 *
 * receive_syn_ack
 *
 */
function receive_syn_ack(conn, hdr) {
    var nu = conn.nudp;
    dbg.log0('receive_syn_ack', nu.connid, 'state', nu.state, 'attempt', hdr.seq);
    if (nu.state === STATE_INIT) {
        nu.state = STATE_CONNECTED;
        if (nu.connect_defer) {
            nu.connect_defer.resolve();
            nu.connect_defer = null;
        }
    }
}


/**
 *
 * receive_fin
 *
 */
function receive_fin(conn, hdr) {
    var nu = conn.nudp;
    dbg.log0('receive_fin', nu.connid, 'state', nu.state, 'attempt', hdr.seq);
    nu.state = STATE_CLOSED;
    conn.close();
}


/**
 *
 * receive_data_packet
 *
 */
function receive_data_packet(conn, hdr, buffer) {
    var nu = conn.nudp;
    var packet = {
        hdr: hdr,
        payload: buffer.slice(PACKET_HEADER_LEN)
    };
    if (hdr.seq !== nu.packet_recv_win_seq) {
        dbg.log2('receive_data_packet', nu.connid,
            'push to window seq', hdr.seq,
            'wait for seq', nu.packet_recv_win_seq);
        nu.packet_recv_by_seq[hdr.seq] = packet;
    } else {
        while (packet) {
            dbg.log2('receive_data_packet', nu.connid,
                'pop from window seq', packet.hdr.seq);
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


/**
 *
 * send_acks
 *
 */
function send_acks(conn) {
    var nu = conn.nudp;
    dbg.log2('send_acks', nu.connid, 'count', nu.ack_queue.length);
    clearTimeout(nu.ack_timeout);
    nu.ack_timeout = null;
    while (nu.ack_queue.length) {
        var buf = new Buffer(nu.mtu || nu.mtu_min);
        var count = 0;
        var offset = PACKET_HEADER_LEN;
        while (offset < buf.length && nu.ack_queue.length) {
            var hdr = nu.ack_queue.pop_front();
            buf.writeDoubleBE(hdr.seq, offset);
            offset += 8;
            count += 1;
        }
        write_packet_header(buf, PACKET_TYPE_DATA_ACK, nu.time, nu.rand, count, 0);
        nu.send_packet(buf, 0, offset);
    }
}

/**
 *
 * receive_acks
 *
 */
function receive_acks(conn, hdr, buffer) {
    var nu = conn.nudp;
    dbg.log2('receive_acks', nu.connid, 'count', hdr.seq);
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
            delete nu.packet_send_by_seq[seq];
        } else {
            dbg.log3('receive_acks', nu.connid, 'ignore missing seq', seq);
        }
    }

    process_send_queue(conn);
}


function write_packet_header(buf, type, time, rand, seq, flags) {
    buf.writeUInt32BE(PACKET_MAGIC, 0);
    buf.writeUInt16BE(CURRENT_VERSION, 4);
    buf.writeUInt16BE(type, 6);
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
