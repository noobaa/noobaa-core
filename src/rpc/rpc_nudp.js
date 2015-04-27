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
    close: close,
    listen: listen,
    send: send,
    authenticate: authenticate,
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

var SYN_ATTEMPTS = 10;
var SYN_ATTEMPT_DELAY = 100;

var WINDOW_BYTES_MAX = 4 * 1024 * 1024;
var WINDOW_LENGTH_MAX = 5000;
var SEND_BATCH_COUNT = 5;
var SEND_RETRANSMIT_DELAY = 100;
var ACK_DELAY = 5;
var ACKS_PER_SEC_MIN = 1000;

var CONN_RAND_CHANCE = {
    min: 1,
    max: UINT32_MAX
};


/**
 *
 * connect
 *
 */
function connect(conn, options) {
    var nu = conn.nudp;
    if (nu) {
        if (nu.connect_defer) {
            return nu.connect_defer.promise;
        }
        if (nu.state === STATE_CONNECTED) {
            return;
        }
        throw new Error('NUDP unexpected connection ' + nu.connid +
            ' state ' + nu.state);
    }

    init_nudp_conn(conn, options.nudp_context);
    nu = conn.nudp;

    // TODO nudp connection keepalive interval

    // send syn packet (with attempts) and wait for syn ack
    send_syn(conn);
    return nu.connect_defer.promise;
}


/**
 *
 * close
 *
 */
function close(conn) {
    var nu = conn.nudp;

    // send fin message
    if (nu.state !== STATE_CLOSED) {
        send_fin(conn);
    }

    // wakeup if anyone is waiting for connect
    if (nu.connect_defer) {
        nu.connect_defer.reject('connection closed');
        nu.connect_defer = null;
    }

    // clear the messages queue
    var message = nu.messages_send_queue.pop_front();
    while (message) {
        if (message.send_defer) {
            message.send_defer.reject('connection closed');
            message.send_defer = null;
        }
        message = nu.messages_send_queue.pop_front();
    }

    // clear the packets send queue
    var packet = nu.packets_send_queue.pop_front();
    while (packet) {
        if (packet.message.send_defer) {
            packet.message.send_defer.reject('connection closed');
            packet.message.send_defer = null;
        }
        packet = nu.packets_send_queue.pop_front();
    }

    // clear the send window packets
    packet = nu.packets_send_window.pop_front();
    while (packet) {
        packet = nu.packets_send_window.pop_front();
    }

    // clear the delayed acks queue
    var hdr = nu.delayed_acks_queue.pop_front();
    while (hdr) {
        hdr = nu.delayed_acks_queue.pop_front();
    }

    // update the state
    delete nu.context.connections[nu.connid];
    nu.state = STATE_CLOSED;
}


/**
 *
 * listen
 *
 */
function listen(rpc, port) {
    var nudp_context = {
        port: port,
        socket: dgram.createSocket('udp4'),
        connections: {}
    };
    nudp_context.socket.on('message',
        receive_packet.bind(null, rpc, nudp_context));
    nudp_context.socket.on('close', function() {
        // TODO can udp sockets just close?
        dbg.error('NUDP socket closed');
    });
    nudp_context.socket.on('error', function(err) {
        // TODO can udp sockets just error?
        dbg.error('NUDP socket error', err.stack || err);
    });
    return Q.ninvoke(nudp_context.socket, 'bind', port)
        .thenResolve(nudp_context);
}


/**
 *
 * send
 *
 */
function send(conn, buffer, op, req) {
    var nu = conn.nudp;
    var send_defer = Q.defer();
    if (!buffer || !buffer.length) {
        throw new Error('cannot send empty message');
    }
    nu.messages_send_queue.push_back({
        send_defer: send_defer,
        conn: conn,
        buffer: buffer,
        offset: 0,
        num_packets: 0,
        acked_packets: 0,
    });
    populate_send_window(conn);
    return send_defer.promise;
}


/**
 *
 * authenticate
 *
 */
function authenticate(conn, auth_token) {
    // TODO for now just save auth_token and send with every message, better send once
}


///////////////////////////////////////////////////////////////////////////////


/**
 *
 * init_nudp_conn
 *
 */
function init_nudp_conn(conn, nudp_context, time, rand) {
    if (!nudp_context) {
        throw new Error('no nudp context');
    }

    time = time || Date.now();
    rand = rand || chance.integer(CONN_RAND_CHANCE);
    var connid = conn.address +
        '/' + time.toString(16) +
        '.' + rand.toString(16);
    nudp_context.connections[connid] = conn;

    var nu = conn.nudp = {
        context: nudp_context,
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
        connid: connid,

        // the message send queue is the first phase for sending messages,
        // and its main purpose is to maintain the buffer message boundary,
        // and a Q.defer used to wakeup the caller once acknowledged.
        messages_send_queue: new LinkedList('m'),

        // the send & receive windows holding packet objects which are being
        // transmitted over the connection, and will be marked and removed
        // when the acknowledge is received.
        packets_send_wait_ack_map: {},
        packets_send_queue: new LinkedList('s'),
        packets_send_window: new LinkedList('w'),
        packets_send_window_bytes: 0,
        packets_send_window_seq: 1,
        packets_ack_counter: 0,
        packets_ack_counter_last_val: 0,
        packets_ack_counter_last_time: 0,
        packets_retrasmits: 0,
        packets_retrasmits_last_val: 0,
        send_packets_report_last_time: 0,

        packets_receive_window_seq: 1,
        packets_receive_window_map: {},
        packets_receive_message_buffers: [],
        packets_receive_message_bytes: 0,

        delayed_acks_queue: new LinkedList('a'),

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
 * fake_conn
 *
 * returns a sort of a connection object that is used just to send fin replies
 * to remote addresses that do not know that their connection is closed.
 *
 */
function fake_conn(socket, address, port, connid, time, rand) {
    var conn = {};
    conn.nudp = {
        state: 'fake',
        time: time,
        rand: rand,
        connid: connid,
        send_packet: function(buf, offset, count) {
            socket.send(
                buf,
                offset || 0,
                count || buf.length,
                port,
                address);
        }
    };
    return conn;
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
    var packet = nu.packets_send_window.get_front();
    while (packet && packet.ack) {
        dbg.log2(nu.connid, 'trim_send_window: seq', packet.seq);
        nu.packets_send_window_bytes -= packet.len;
        nu.packets_send_window.pop_front();
        packet = nu.packets_send_window.get_front();
    }
}


/**
 *
 * populate_send_window
 *
 * fill the send window from the message send queue.
 * this is bit heavy work of cpu/memory due to buffer copying.
 *
 */
function populate_send_window(conn) {
    var nu = conn.nudp;
    dbg.log2(nu.connid, 'populate_send_window:',
        'len', nu.packets_send_window.length,
        'bytes', nu.packets_send_window_bytes);
    var populated = 0;
    while (nu.packets_send_window.length < WINDOW_LENGTH_MAX &&
        nu.packets_send_window_bytes < WINDOW_BYTES_MAX) {
        var message = nu.messages_send_queue.get_front();
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
        var seq = nu.packets_send_window_seq;
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
            nu.messages_send_queue.remove(message);
            message.populated = true;
        }
        populated += 1;
        nu.packets_send_wait_ack_map[seq] = packet;
        nu.packets_send_queue.push_front(packet);
        nu.packets_send_window.push_back(packet);
        nu.packets_send_window_seq += 1;
        nu.packets_send_window_bytes += packet_len;
        dbg.log2(nu.connid, 'populate_send_window: seq', packet.seq);
    }

    if (populated) {
        // wakeup sender if sleeping
        if (!nu.process_send_immediate) {
            nu.process_send_immediate = setImmediate(send_packets, conn);
        }
    }
}


/**
 *
 * send_packets
 *
 */
function send_packets(conn) {
    var nu = conn.nudp;

    clearTimeout(nu.process_send_timeout);
    clearImmediate(nu.process_send_immediate);
    nu.process_send_timeout = null;
    nu.process_send_immediate = null;

    if (!nu || nu.state !== STATE_CONNECTED) {
        conn.emit('error', new Error('NUDP not connected'));
        return;
    }
    if (!nu.packets_send_queue.length) {
        return;
    }
    dbg.log2(nu.connid, 'send_packets: length', nu.packets_send_queue.length);

    var now = Date.now();
    var batch_count = 0;
    var send_delay = 0;
    var packet = nu.packets_send_queue.get_front();
    var last_packet = nu.packets_send_queue.get_back();
    while (packet && batch_count < SEND_BATCH_COUNT) {

        // resend packets only if last send was above a threshold
        send_delay = SEND_RETRANSMIT_DELAY - (now - packet.last_sent);
        if (send_delay > 0) {
            break;
        }

        dbg.log2(nu.connid, 'send_batch',
            'seq', packet.seq,
            'len', packet.len,
            'transmits', packet.transmits);
        packet.transmits += 1;
        if (packet.transmits > 1) {
            nu.packets_retrasmits += 1;
        }
        packet.last_sent = now;
        batch_count += 1;
        nu.send_packet(packet.buffer, 0, packet.len);

        // move packet to end of the send queue
        // keep the next packet so we keep iterating even when we mutate the list
        var next_packet = nu.packets_send_queue.get_next(packet);
        nu.packets_send_queue.remove(packet);
        nu.packets_send_queue.push_back(packet);
        // stop once completed cycle on all packets
        if (packet === last_packet) {
            break;
        }
        packet = next_packet;
    }

    var hrtime = process.hrtime();
    var hrsec = hrtime[0] + hrtime[1] / 1e9;
    var dt = hrsec - nu.packets_ack_counter_last_time;
    var num_acks = nu.packets_ack_counter - nu.packets_ack_counter_last_val;
    var acks_per_sec = num_acks / dt;
    var num_retrans = nu.packets_retrasmits - nu.packets_retrasmits_last_val;
    var retrans_per_sec = num_retrans / dt;

    // try to push the rate up by 8%, since we might have more bandwidth to use.
    var rate_change;
    if (retrans_per_sec < 50) {
        rate_change = 1.5;
    } else if (retrans_per_sec < 100) {
        rate_change = 1.1;
    } else if (retrans_per_sec < 300) {
        rate_change = 1;
    } else if (retrans_per_sec < 700) {
        rate_change = 0.8;
    } else {
        rate_change = 0.5;
    }

    // calculate the number of millis available for each batch.
    var ms_per_batch = 1000 * SEND_BATCH_COUNT /
        (rate_change * Math.max(acks_per_sec, ACKS_PER_SEC_MIN));

    // print a report
    if (hrsec - nu.send_packets_report_last_time >= 3) {
        dbg.log0(nu.connid, 'send_packets:',
            'num_acks', num_acks,
            'acks_per_sec', acks_per_sec.toFixed(2),
            'retrans_per_sec', retrans_per_sec.toFixed(2),
            'ms_per_batch', ms_per_batch.toFixed(2));
        nu.send_packets_report_last_time = hrsec;
    }

    // update the saved values once in fixed intervals
    if (dt >= 0.03) {
        nu.packets_ack_counter_last_time = hrsec;
        nu.packets_ack_counter_last_val = nu.packets_ack_counter;
        nu.packets_retrasmits_last_val = nu.packets_retrasmits;
    }

    // schedule next send according to calculated rate
    // a small minimum number of milliseconds is needed for setTiemout
    // because the timer will not be able to wake us up in sub milli times,
    // so for higher rates we use setImmediate, but that will leave less
    // cpu time for other tasks...
    send_delay = Math.max(send_delay, ms_per_batch);
    if (send_delay > 5) {
        nu.process_send_timeout =
            setTimeout(send_packets, send_delay, conn);
    } else {
        nu.process_send_immediate =
            setImmediate(send_packets, conn);
    }
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
    dbg.log2(connid, 'receive_packet:',
        'type', hdr.type,
        'seq', hdr.seq);
    var conn = nudp_context.connections[connid];
    if (!conn) {
        if (hdr.type !== PACKET_TYPE_SYN) {
            dbg.log2(connid, 'receive_packet: expected SYN');
            send_fin(fake_conn(
                nudp_context.socket,
                rinfo.address, rinfo.port,
                connid, hdr.time, hdr.rand));
            return;
        }
        dbg.log0(connid, 'receive_packet: NUDP NEW CONNECTION');
        conn = rpc.new_connection(address);
        init_nudp_conn(conn, nudp_context, hdr.time, hdr.rand);
    }
    var nu = conn.nudp;
    if (nu.state === STATE_CLOSED) {
        dbg.log2(nu.connid, 'receive_packet: connection is closed, send FIN');
        send_fin(conn);
        return;
    }

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
            dbg.error(nu.connid, 'receive_packet BAD PACKET TYPE', hdr);
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
        dbg.log0(nu.connid, 'send_syn:',
            'state', nu.state,
            'attempt', attempt);

        // if state is not init we are done trying to SYN -
        // might be connected or closed already.
        if (nu.state !== STATE_INIT) {
            return;
        }

        // limit attempts
        if (attempt > SYN_ATTEMPTS) {
            conn.emit('error', new Error(nu.connid + ' send_syn: connect exhuasted'));
            return;
        }

        // send the SYN attempt sequence over the hdr.seq field
        write_packet_header(syn_buf, PACKET_TYPE_SYN, nu.time, nu.rand, attempt, 0);
        nu.send_packet(syn_buf);
        timer = setTimeout(next_attempt, SYN_ATTEMPT_DELAY);
    }
}

/**
 *
 * receive_syn
 *
 */
function receive_syn(conn, hdr) {
    var nu = conn.nudp;
    dbg.log0(nu.connid, 'receive_syn:',
        'state', nu.state,
        'attempt', hdr.seq);

    if (nu.state === STATE_INIT) {
        nu.state = STATE_CONNECTED;
        if (nu.connect_defer) {
            nu.connect_defer.resolve();
            nu.connect_defer = null;
        }
    }

    // for every SYN we accept we reply with SYN ACK
    // so even if the message is lost, the retries on send_syn will resolve.
    // reply back the SYN attempt sequence which is sent over the hdr.seq field.
    if (nu.state === STATE_CONNECTED) {
        var syn_ack_buf = new Buffer(PACKET_HEADER_LEN);
        write_packet_header(syn_ack_buf, PACKET_TYPE_SYN_ACK, nu.time, nu.rand, hdr.seq, 0);
        nu.send_packet(syn_ack_buf);
    }
}



/**
 *
 * receive_syn_ack
 *
 */
function receive_syn_ack(conn, hdr) {
    var nu = conn.nudp;
    dbg.log0(nu.connid, 'receive_syn_ack:',
        'state', nu.state,
        'attempt', hdr.seq);

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
 * send_fin
 *
 */
function send_fin(conn) {
    var nu = conn.nudp;
    dbg.log0(nu.connid, 'send_fin:',
        'state', nu.state);

    var fin_buf = new Buffer(PACKET_HEADER_LEN);
    write_packet_header(fin_buf, PACKET_TYPE_FIN, nu.time, nu.rand, 0, 0);
    nu.send_packet(fin_buf);
}


/**
 *
 * receive_fin
 *
 */
function receive_fin(conn, hdr) {
    var nu = conn.nudp;
    dbg.log0(nu.connid, 'receive_fin:',
        'state', nu.state);

    conn.close();
}


/**
 *
 * receive_data_packet
 *
 */
function receive_data_packet(conn, hdr, buffer) {
    var nu = conn.nudp;
    var add_to_acks_queue = true;

    if (hdr.seq > nu.packets_receive_window_seq + WINDOW_LENGTH_MAX) {

        // checking if the received sequence is out of the window length
        // TODO reply with NEGATIVE ACK ?

        dbg.log2(nu.connid, 'receive_data_packet:',
            'drop seq out of window', hdr.seq);
        add_to_acks_queue = false;

    } else if (hdr.seq < nu.packets_receive_window_seq) {

        // checking if the received sequence is old, and then drop it.
        // this case means we get dup packets.
        // we still send an ack for this packet to help release the sender.
        // TODO reply with DUP ACK ?

        dbg.log2(nu.connid, 'receive_data_packet:',
            'drop old seq', hdr.seq);

    } else {

        var packet = {
            hdr: hdr,
            payload: buffer.slice(PACKET_HEADER_LEN)
        };

        if (hdr.seq === nu.packets_receive_window_seq) {
            do {

                // when we get the next packet we waited for we can collapse
                // the window of the next queued packets as well, and join them
                // to the received message.
                dbg.log2(nu.connid, 'receive_data_packet:',
                    'pop from window seq', packet.hdr.seq);
                delete nu.packets_receive_window_map[nu.packets_receive_window_seq];
                nu.packets_receive_message_buffers.push(packet.payload);
                nu.packets_receive_message_bytes += packet.payload.length;
                nu.packets_receive_window_seq += 1;

                // checking if this packet is a message boundary packet
                // and in that case we extract it and emit to the connection.
                if (packet.hdr.flags & PACKET_FLAG_BOUNDARY_END) {
                    var msg = Buffer.concat(
                        nu.packets_receive_message_buffers,
                        nu.packets_receive_message_bytes);
                    nu.packets_receive_message_buffers.length = 0;
                    nu.packets_receive_message_bytes = 0;
                    conn.receive(msg);
                }
                packet = nu.packets_receive_window_map[nu.packets_receive_window_seq];
            } while (packet);

        } else {

            // if the packet is not the next awaited sequence,
            // then we save it for when that missing seq arrives
            dbg.log2(nu.connid, 'receive_data_packet:',
                'push to window seq', hdr.seq,
                'wait for seq', nu.packets_receive_window_seq);
            nu.packets_receive_window_map[hdr.seq] = packet;
        }
    }


    // queue a delayed ack
    if (add_to_acks_queue) {
        nu.delayed_acks_queue.push_back(hdr);
    }
    if (!nu.delayed_acks_timeout) {
        nu.delayed_acks_timeout =
            setTimeout(send_delayed_acks, ACK_DELAY, conn);
    }
}


/**
 *
 * send_delayed_acks
 *
 */
function send_delayed_acks(conn) {
    var nu = conn.nudp;
    var missing_seq = nu.packets_receive_window_seq;
    dbg.log1(nu.connid, 'send_delayed_acks:',
        'count', nu.delayed_acks_queue.length,
        'missing_seq', missing_seq);

    clearTimeout(nu.delayed_acks_timeout);
    nu.delayed_acks_timeout = null;

    // send at least one ACK packet even if the queue is empty,
    // in order to send the missing_seq.
    do {
        var buf = new Buffer(nu.mtu || nu.mtu_min);
        var offset = PACKET_HEADER_LEN;

        // fill the buffer with list of acks.
        while (offset < buf.length && nu.delayed_acks_queue.length) {
            var hdr = nu.delayed_acks_queue.pop_front();
            buf.writeDoubleBE(hdr.seq, offset);
            offset += 8;
        }

        write_packet_header(buf, PACKET_TYPE_DATA_ACK, nu.time, nu.rand, missing_seq, 0);
        nu.send_packet(buf, 0, offset);
    } while (nu.delayed_acks_queue.length);
}

/**
 *
 * receive_acks
 *
 */
function receive_acks(conn, hdr, buffer) {
    var nu = conn.nudp;
    dbg.log1(nu.connid, 'receive_acks:',
        'count', (buffer.length - PACKET_HEADER_LEN) / 8);

    var offset = PACKET_HEADER_LEN;
    while (offset < buffer.length) {
        var seq = buffer.readDoubleBE(offset);
        offset += 8;

        var packet = nu.packets_send_wait_ack_map[seq];
        delete nu.packets_send_wait_ack_map[seq];
        if (!packet) {
            dbg.log3(nu.connid, 'receive_acks: ignore missing seq', seq);
            continue;
        }

        // update the packet and remove from pending send list
        packet.ack = true;
        nu.packets_send_queue.remove(packet);
        nu.packets_ack_counter += 1;

        // check if this ack is the last ACK waited by this message,
        // and wakeup the sender.
        packet.message.acked_packets += 1;
        if (packet.message.offset >= packet.message.buffer.length &&
            packet.message.acked_packets === packet.message.num_packets) {
            packet.message.send_defer.resolve();
            packet.message.send_defer = null;
        }
    }

    // for the missing packet we force resend
    var missing_seq = hdr.seq;
    var missing_packet = nu.packets_send_wait_ack_map[missing_seq];
    if (missing_packet) {
        nu.packets_send_queue.remove(missing_packet);
        nu.packets_send_queue.push_front(missing_packet);
        missing_packet.last_sent = 0;
    }

    // after receiving ACKs we trim send window to allow adding new messages,
    // and then populate the send window with more packets from pending messages.
    trim_send_window(conn);
    populate_send_window(conn);
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
