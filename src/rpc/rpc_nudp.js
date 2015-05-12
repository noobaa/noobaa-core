'use strict';

// var _ = require('lodash');
var Q = require('q');
var dgram = require('dgram');
var stun = require('./stun');
var LinkedList = require('noobaa-util/linked_list');
var dbg = require('noobaa-util/debug_module')(__filename);
// var rpc_nudp_native = require('../../build/Release/rpc_nudp_native.node');


module.exports = {
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

var MTU_DEFAULT = 1200;
var MTU_MIN = 576;
var MTU_MAX = 64 * 1024;

var SYN_ATTEMPTS = 20;
var SYN_ATTEMPT_DELAY = 100;

var WINDOW_BYTES_MAX = 4 * 1024 * 1024;
var WINDOW_LENGTH_MAX = 5000;
var SEND_BATCH_COUNT = 5;
var SEND_RETRANSMIT_DELAY = 100;
var ACKS_PER_SEC_MIN = 1000;
var ACK_DELAY = 5;
var SYN_ACK_DELAY = 50;
var FIN_DELAY = 500;


/**
 *
 * connect
 *
 */
function connect(conn, options) {
    var nc = conn.nudp;
    if (nc) {

        // if connect is called with concurrency we join
        // the callers using the connect defer here.
        if (nc.connect_defer) {
            return nc.connect_defer.promise;
        }

        // already connected
        if (nc.state === STATE_CONNECTED) {
            return;
        }

        throw new Error('NUDP DISCONNECTED (state ' + nc.state + ')' +
            ' connid ' + nc.connid);
    }

    nc = init_nudp_conn(conn, options.nudp_socket);

    // TODO nudp connection keepalive interval

    // send syn packet (with attempts) and wait for syn ack
    send_syn(nc);

    // wait for connect to complete when peer sends SYN ACK
    return nc.connect_defer.promise;
}


/**
 *
 * close
 *
 */
function close(conn) {
    close_nudp_conn(conn.nudp);
}


/**
 *
 * listen
 *
 */
function listen(rpc, port) {
    var nudp_socket = {
        port: port,
        socket: dgram.createSocket('udp4'),
        addresses: {}
    };

    // the socket multiplexes with stun so we receive also
    // stun messages by our listener, but the stun listener already handled
    // them so we just need to ignore it here.
    nudp_socket.socket.on('message', function(buffer, rinfo) {
        if (!stun.is_stun_packet(buffer)) {
            receive_packet(rpc, nudp_socket, buffer, rinfo);
        }
    });

    // if this can occur spontanuously, then we need to maintain
    // all the connections that use this socket, and call close on them,
    // which is tedious. so lets be optimistic about it for now.
    // in the meanwhile we log and throw uncaught exception to panic the process.
    nudp_socket.socket.on('close', function() {
        dbg.error('NUDP SOCKET CLOSED UNEXPECTEDLY');
        process.nextTick(function() {
            throw new Error('NUDP SOCKET CLOSED UNEXPECTEDLY');
        });
    });

    // see explanation in the close event above.
    // however we already see this occuring -
    // for example on ESRCH error from getaddrinfo() for dns resolve.
    nudp_socket.socket.on('error', function(err) {
        dbg.error('NUDP SOCKET ERROR', err.stack || err);
    });

    // this is a stun response from a stun server, letting us know
    // what is our reflexive address as it sees us.
    // we keep all the addresses we discover in a map (without dups),
    // so they can be used later for contacting us from other peers.
    nudp_socket.socket.on('stun.address', function(addr) {
        dbg.log0('NUDP STUN address', addr);
        nudp_socket.addresses[addr.address + ':' + addr.port] = addr;
    });

    // this is a stun keepalive that we receive as we are also
    // acting as a mini stun server.
    // anyhow indications are meant to be ignored.
    nudp_socket.socket.on('stun.indication', function(rinfo) {
        dbg.log3('NUDP STUN indication', rinfo.address + ':' + rinfo.port);
    });

    // this is an explicit error reply sent from stun server
    // so most likely something wrong about the protocol.
    // nothing much to do about it here since the udp socket and
    // the connections are fine, so if this occurs we need to
    // debug the stun request/response that caused it.
    nudp_socket.socket.on('stun.error', function(rinfo) {
        dbg.warn('NUDP STUN ERROR', rinfo.address + ':' + rinfo.port);
    });

    // bind the udp socket to requested port (can be 0 to allocate random)
    return Q.ninvoke(nudp_socket.socket, 'bind', port)
        .then(function() {
            // update port in case it was 0 to bind to any port
            nudp_socket.port = nudp_socket.socket.address().port;

            // pick some stun server (google by default)
            nudp_socket.stun_url = stun.STUN.PUBLIC_SERVERS[0];
            /* TEST: send to myself...
            nudp_socket.stun_url = {
                hostname: '127.0.0.1',
                port: nudp_socket.port,
            }; */

            // connet the socket to stun server by sending stun request
            // and keep the stun mapping open after by sending indications
            // periodically.
            return stun.connect_socket(
                nudp_socket.socket,
                nudp_socket.stun_url.hostname,
                nudp_socket.stun_url.port);
        })
        .then(function() {
            return nudp_socket;
        });
}


/**
 *
 * send
 *
 */
function send(conn, buffer, op, req) {
    var nc = conn.nudp;
    if (!buffer || !buffer.length) {
        throw new Error('NUDP cannot send empty message');
    }
    var send_defer = Q.defer();
    nc.messages_send_queue.push_back({
        req: req,
        send_defer: send_defer,
        buffer: buffer,
        offset: 0,
        num_packets: 0,
        acked_packets: 0,
    });
    populate_send_window(nc);
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
function init_nudp_conn(conn, nudp_socket) {
    if (!nudp_socket) {
        throw new Error('NUDP SOCKET MISSING');
    }

    // caching these for send_packet
    var socket = nudp_socket.socket;
    var hostname = conn.url.hostname;
    var port = conn.url.port;

    var nc = {
        conn: conn,
        time: conn.time,
        rand: conn.rand,
        connid: conn.connid,

        state: STATE_INIT,
        connect_defer: Q.defer(),

        send_packet: send_packet,
        receive_message: receive_message,
        raise_error: raise_error,

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

        delayed_syn_ack_timeout: {},
        delayed_fin_timeout: {},
        delayed_acks_queue: new LinkedList('a'),

        mtu_min: MTU_MIN,
        mtu_max: MTU_MAX,
        mtu: MTU_DEFAULT,
    };

    conn.nudp = nc;
    return nc;

    function send_packet(buf, offset, count) {
        socket.send(
            buf,
            offset || 0,
            count || buf.length,
            port,
            hostname,
            raise_error);
    }

    function receive_message(msg) {
        conn.receive(msg);
    }

    function raise_error(err) {
        if (err) {
            dbg.error('NUDP ERROR', err.stack || err);
            conn.emit('error', err);
        }
    }
}



/**
 *
 */
function close_nudp_conn(nc) {

    // send fin message to other end
    if (nc.state !== STATE_CLOSED) {
        schedule_delayed_fin(nc);
    }

    // wakeup if anyone is waiting for connect
    close_defer(nc, 'connect_defer');

    // clear the messages queue
    var message = nc.messages_send_queue.pop_front();
    while (message) {
        close_defer(message, 'send_defer');
        message = nc.messages_send_queue.pop_front();
    }

    // clear the packets send queue
    var packet = nc.packets_send_queue.pop_front();
    while (packet) {
        close_defer(packet.message, 'send_defer');
        packet = nc.packets_send_queue.pop_front();
    }

    // clear the send window packets
    packet = nc.packets_send_window.pop_front();
    while (packet) {
        packet = nc.packets_send_window.pop_front();
    }

    // clear the delayed acks queue
    var hdr = nc.delayed_acks_queue.pop_front();
    while (hdr) {
        hdr = nc.delayed_acks_queue.pop_front();
    }

    nc.state = STATE_CLOSED;
}


function close_defer(container, name) {
    if (container[name]) {
        container[name].reject('NUDP connection closed');
        container[name] = null;
    }
}


/**
 *
 * init_fake_nc
 *
 * returns a sort of a connection object that is used just to send fin replies
 * to remote addresses that do not know that their connection is closed.
 *
 */
function init_fake_nc(socket, hostname, port, address, time, rand) {
    return {
        state: 'fake',
        time: time,
        rand: rand,
        connid: address + '/' + time.toString(16) + '.' + rand.toString(16),
        delayed_fin_timeout: {},
        send_packet: function(buf, offset, count) {
            socket.send(
                buf,
                offset || 0,
                count || buf.length,
                port,
                hostname);
        }
    };
}


/**
 *
 * trim_send_window
 *
 * "trim left" acknowledged packets from the window
 *
 */
function trim_send_window(nc) {
    var packet = nc.packets_send_window.get_front();
    while (packet && packet.ack) {
        dbg.log2('NUDP trim_send_window: seq', packet.seq, nc.connid);
        nc.packets_send_window_bytes -= packet.len;
        nc.packets_send_window.pop_front();
        packet = nc.packets_send_window.get_front();
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
function populate_send_window(nc) {
    dbg.log2('NUDP populate_send_window:',
        'len', nc.packets_send_window.length,
        'bytes', nc.packets_send_window_bytes,
        nc.connid);
    var populated = 0;
    while (nc.packets_send_window.length < WINDOW_LENGTH_MAX &&
        nc.packets_send_window_bytes < WINDOW_BYTES_MAX) {
        var message = nc.messages_send_queue.get_front();
        if (!message) {
            break;
        }
        var buf = new Buffer(nc.mtu || nc.mtu_min);
        var packet_remain = buf.length - PACKET_HEADER_LEN;
        var message_remain = message.buffer.length - message.offset;
        var payload_len = Math.min(packet_remain, message_remain);
        var packet_len = PACKET_HEADER_LEN + payload_len;
        var flags = 0;
        if (packet_remain >= message_remain) {
            flags |= PACKET_FLAG_BOUNDARY_END;
        }
        var seq = nc.packets_send_window_seq;
        var packet = {
            seq: seq,
            buffer: buf,
            len: packet_len,
            transmits: 0,
            last_sent: 0,
            message: message
        };
        write_packet_header(buf, PACKET_TYPE_DATA, nc.time, nc.rand, seq, flags);
        message.buffer.copy(
            buf, PACKET_HEADER_LEN,
            message.offset, message.offset + payload_len);
        message.offset += payload_len;
        message.num_packets += 1;
        if (message.offset >= message.buffer.length) {
            nc.messages_send_queue.remove(message);
            message.populated = true;
        }
        populated += 1;
        nc.packets_send_wait_ack_map[seq] = packet;
        nc.packets_send_queue.push_front(packet);
        nc.packets_send_window.push_back(packet);
        nc.packets_send_window_seq += 1;
        nc.packets_send_window_bytes += packet_len;
        dbg.log2('NUDP populate_send_window: seq', packet.seq, nc.connid);
    }

    if (populated) {
        // wakeup sender if sleeping
        if (!nc.process_send_immediate) {
            nc.process_send_immediate = setImmediate(send_packets, nc);
        }
    }
}


/**
 *
 * send_packets
 *
 */
function send_packets(nc) {
    clearTimeout(nc.process_send_timeout);
    clearImmediate(nc.process_send_immediate);
    nc.process_send_timeout = null;
    nc.process_send_immediate = null;

    if (!nc || nc.state !== STATE_CONNECTED) {
        nc.raise_error(new Error('NUDP not connected'));
        return;
    }
    if (!nc.packets_send_queue.length) {
        return;
    }
    dbg.log2('NUDP send_packets:',
        'length', nc.packets_send_queue.length,
        nc.connid);

    var now = Date.now();
    var batch_count = 0;
    var send_delay = 0;
    var packet = nc.packets_send_queue.get_front();
    var last_packet = nc.packets_send_queue.get_back();
    while (packet && batch_count < SEND_BATCH_COUNT) {

        // resend packets only if last send was above a threshold
        send_delay = SEND_RETRANSMIT_DELAY - (now - packet.last_sent);
        if (send_delay > 0) {
            break;
        }

        dbg.log2('NUDP send_packets:',
            'seq', packet.seq,
            'len', packet.len,
            'transmits', packet.transmits,
            nc.connid);
        packet.transmits += 1;
        if (packet.transmits > 1) {
            nc.packets_retrasmits += 1;
        }
        packet.last_sent = now;
        batch_count += 1;
        nc.send_packet(packet.buffer, 0, packet.len);

        // move packet to end of the send queue
        // keep the next packet so we keep iterating even when we mutate the list
        var next_packet = nc.packets_send_queue.get_next(packet);
        nc.packets_send_queue.remove(packet);
        nc.packets_send_queue.push_back(packet);
        // stop once completed cycle on all packets
        if (packet === last_packet) {
            break;
        }
        packet = next_packet;
    }

    var hrtime = process.hrtime();
    var hrsec = hrtime[0] + hrtime[1] / 1e9;
    var dt = hrsec - nc.packets_ack_counter_last_time;
    var num_acks = nc.packets_ack_counter - nc.packets_ack_counter_last_val;
    var acks_per_sec = num_acks / dt;
    var num_retrans = nc.packets_retrasmits - nc.packets_retrasmits_last_val;
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
    if (hrsec - nc.send_packets_report_last_time >= 3) {
        dbg.log0('NUDP send_packets:',
            'num_acks', num_acks,
            'acks_per_sec', acks_per_sec.toFixed(2),
            'retrans_per_sec', retrans_per_sec.toFixed(2),
            'ms_per_batch', ms_per_batch.toFixed(2),
            nc.connid);
        nc.send_packets_report_last_time = hrsec;
    }

    // update the saved values once in fixed intervals
    if (dt >= 0.03) {
        nc.packets_ack_counter_last_time = hrsec;
        nc.packets_ack_counter_last_val = nc.packets_ack_counter;
        nc.packets_retrasmits_last_val = nc.packets_retrasmits;
    }

    // schedule next send according to calculated rate
    // a small minimum number of milliseconds is needed for setTiemout
    // because the timer will not be able to wake us up in sub milli times,
    // so for higher rates we use setImmediate, but that will leave less
    // cpu time for other tasks...
    send_delay = Math.max(send_delay, ms_per_batch);
    if (send_delay > 5) {
        nc.process_send_timeout =
            setTimeout(send_packets, send_delay, nc);
    } else {
        nc.process_send_immediate =
            setImmediate(send_packets, nc);
    }
}


/**
 *
 * receive_packet
 *
 */
function receive_packet(rpc, nudp_socket, buffer, rinfo) {
    var hdr = read_packet_header(buffer);
    var address = 'nudp://' + rinfo.address + ':' + rinfo.port;
    var allow_create_conn = hdr.type === PACKET_TYPE_SYN;
    var conn = rpc.get_connection_by_id(address, hdr.time, hdr.rand, allow_create_conn);

    if (!conn) {
        // if we get FIN and no connection we can ignore.
        // for any other packet reply back with FIN.
        if (hdr.type !== PACKET_TYPE_FIN) {
            var fake_nc = init_fake_nc(
                nudp_socket.socket, rinfo.address, rinfo.port,
                address, hdr.time, hdr.rand);
            dbg.log2('NUDP receive_packet: expected SYN or FIN', hdr.type,
                'connid', fake_nc.connid);
            schedule_delayed_fin(fake_nc);
        }
        return;
    }

    dbg.log2('NUDP receive_packet:',
        'type', hdr.type,
        'seq', hdr.seq,
        'connid', conn.connid);

    var nc = conn.nudp;
    if (!nc) {
        dbg.log0('NUDP receive_packet: NEW CONNECTION connid', conn.connid);
        nc = init_nudp_conn(conn, nudp_socket);
    }
    if (nc.state === STATE_CLOSED) {
        dbg.warn('NUDP receive_packet: connection is closed, send FIN connid', nc.connid);
        schedule_delayed_fin(nc);
        return;
    }

    switch (hdr.type) {
        case PACKET_TYPE_SYN:
            receive_syn(nc, hdr);
            break;
        case PACKET_TYPE_SYN_ACK:
            receive_syn_ack(nc, hdr);
            break;
        case PACKET_TYPE_FIN:
            receive_fin(nc, hdr);
            break;
        case PACKET_TYPE_DATA:
            receive_data_packet(nc, hdr, buffer);
            break;
        case PACKET_TYPE_DATA_ACK:
            receive_acks(nc, hdr, buffer);
            break;
        default:
            dbg.error('NUDP receive_packet BAD PACKET TYPE', hdr, 'connid', nc.connid);
            break;
    }
}


/**
 *
 * send_syn
 *
 */
function send_syn(nc) {
    var syn_buf = new Buffer(PACKET_HEADER_LEN);
    var attempt = 0;
    var timer;
    next_attempt();

    function next_attempt() {
        attempt += 1;
        clearTimeout(timer);
        dbg.log0('NUDP send_syn:',
            'state', nc.state,
            'attempt', attempt,
            nc.connid);

        // if state is not init we are done trying to SYN -
        // might be connected or closed already.
        if (nc.state !== STATE_INIT) {
            return;
        }

        // limit attempts
        if (attempt > SYN_ATTEMPTS) {
            nc.raise_error(new Error('NUDP send_syn: connect exhuasted ' + nc.connid));
            return;
        }

        // send the SYN attempt sequence over the hdr.seq field
        write_packet_header(syn_buf, PACKET_TYPE_SYN, nc.time, nc.rand, attempt, 0);
        nc.send_packet(syn_buf);
        timer = setTimeout(next_attempt, SYN_ATTEMPT_DELAY);
    }
}

/**
 *
 * receive_syn
 *
 */
function receive_syn(nc, hdr) {
    dbg.log0('NUDP receive_syn:',
        'state', nc.state,
        'syn seq', hdr.seq,
        nc.connid);

    switch (nc.state) {
        case STATE_INIT:
            nc.state = STATE_CONNECTED;
            if (nc.connect_defer) {
                nc.connect_defer.resolve();
                nc.connect_defer = null;
            }
            schedule_delayed_syn_ack(nc, hdr);
            break;
        case STATE_CONNECTED:
            schedule_delayed_syn_ack(nc, hdr);
            break;
        default:
            break;
    }
}


/**
 *
 * schedule_delayed_syn_ack
 *
 */
function schedule_delayed_syn_ack(nc, hdr) {
    if (!nc.delayed_syn_ack_timeout[nc.connid]) {
        nc.delayed_syn_ack_timeout[nc.connid] =
            setTimeout(send_syn_ack, SYN_ACK_DELAY, nc, hdr);
    }
}

/**
 *
 * send_syn_ack
 *
 */
function send_syn_ack(nc, hdr) {
    dbg.log0('NUDP send_syn_ack:',
        'state', nc.state,
        'attempt', hdr.seq,
        nc.connid);

    var syn_ack_buf = new Buffer(PACKET_HEADER_LEN);
    write_packet_header(syn_ack_buf, PACKET_TYPE_SYN_ACK, nc.time, nc.rand, hdr.seq, 0);
    nc.send_packet(syn_ack_buf);
    delete nc.delayed_syn_ack_timeout[nc.connid];
}


/**
 *
 * receive_syn_ack
 *
 */
function receive_syn_ack(nc, hdr) {
    dbg.log0('NUDP receive_syn_ack:',
        'state', nc.state,
        'attempt', hdr.seq,
        nc.connid);

    switch (nc.state) {
        case STATE_INIT:
            nc.state = STATE_CONNECTED;
            if (nc.connect_defer) {
                nc.connect_defer.resolve();
                nc.connect_defer = null;
            }
            break;
        default:
            break;
    }
}


/**
 *
 * schedule_delayed_fin
 *
 */
function schedule_delayed_fin(nc) {
    if (!nc.delayed_fin_timeout[nc.connid]) {
        nc.delayed_fin_timeout[nc.connid] =
            setTimeout(send_fin, FIN_DELAY, nc);
    }
}


/**
 *
 * send_fin
 *
 */
function send_fin(nc) {
    if (nc.state !== 'fake') {
        dbg.log0('NUDP send_fin:',
            'state', nc.state,
            nc.connid);
    }

    var fin_buf = new Buffer(PACKET_HEADER_LEN);
    write_packet_header(fin_buf, PACKET_TYPE_FIN, nc.time, nc.rand, 0, 0);
    nc.send_packet(fin_buf);
    delete nc.delayed_fin_timeout[nc.connid];
}


/**
 *
 * receive_fin
 *
 */
function receive_fin(nc, hdr) {
    dbg.log0('NUDP receive_fin:',
        'state', nc.state,
        nc.connid);
    close_nudp_conn(nc);
}


/**
 *
 * receive_data_packet
 *
 */
function receive_data_packet(nc, hdr, buffer) {
    var add_to_acks_queue = true;

    if (hdr.seq > nc.packets_receive_window_seq + WINDOW_LENGTH_MAX) {

        // checking if the received sequence is out of the window length
        // TODO reply with NEGATIVE ACK ?

        dbg.log2('NUDP receive_data_packet:',
            'drop seq out of window', hdr.seq,
            nc.connid);
        add_to_acks_queue = false;

    } else if (hdr.seq < nc.packets_receive_window_seq) {

        // checking if the received sequence is old, and then drop it.
        // this case means we get dup packets.
        // we still send an ack for this packet to help release the sender.
        // TODO reply with DUP ACK ?

        dbg.log2('NUDP receive_data_packet:',
            'drop old seq', hdr.seq,
            nc.connid);

    } else {

        var packet = {
            hdr: hdr,
            payload: buffer.slice(PACKET_HEADER_LEN)
        };

        if (hdr.seq === nc.packets_receive_window_seq) {
            do {

                // when we get the next packet we waited for we can collapse
                // the window of the next queued packets as well, and join them
                // to the received message.
                dbg.log2('NUDP receive_data_packet:',
                    'pop from window seq', packet.hdr.seq,
                    nc.connid);
                delete nc.packets_receive_window_map[nc.packets_receive_window_seq];
                nc.packets_receive_message_buffers.push(packet.payload);
                nc.packets_receive_message_bytes += packet.payload.length;
                nc.packets_receive_window_seq += 1;

                // checking if this packet is a message boundary packet
                // and in that case we extract it and emit to the connection.
                if (packet.hdr.flags & PACKET_FLAG_BOUNDARY_END) {
                    var msg = Buffer.concat(
                        nc.packets_receive_message_buffers,
                        nc.packets_receive_message_bytes);
                    nc.packets_receive_message_buffers.length = 0;
                    nc.packets_receive_message_bytes = 0;
                    nc.receive_message(msg);
                }
                packet = nc.packets_receive_window_map[nc.packets_receive_window_seq];
            } while (packet);

        } else {

            // if the packet is not the next awaited sequence,
            // then we save it for when that missing seq arrives
            dbg.log2('NUDP receive_data_packet:',
                'push to window seq', hdr.seq,
                'wait for seq', nc.packets_receive_window_seq,
                nc.connid);
            nc.packets_receive_window_map[hdr.seq] = packet;
        }
    }


    // queue a delayed ack
    if (add_to_acks_queue) {
        nc.delayed_acks_queue.push_back(hdr);
    }
    if (!nc.delayed_acks_timeout) {
        nc.delayed_acks_timeout =
            setTimeout(send_delayed_acks, ACK_DELAY, nc);
    }
}


/**
 *
 * send_delayed_acks
 *
 */
function send_delayed_acks(nc) {
    var missing_seq = nc.packets_receive_window_seq;
    dbg.log1('NUDP send_delayed_acks:',
        'count', nc.delayed_acks_queue.length,
        'missing_seq', missing_seq,
        nc.connid);

    clearTimeout(nc.delayed_acks_timeout);
    nc.delayed_acks_timeout = null;

    // send at least one ACK packet even if the queue is empty,
    // in order to send the missing_seq.
    do {
        var buf = new Buffer(nc.mtu || nc.mtu_min);
        var offset = PACKET_HEADER_LEN;

        // fill the buffer with list of acks.
        while (offset < buf.length && nc.delayed_acks_queue.length) {
            var hdr = nc.delayed_acks_queue.pop_front();
            buf.writeDoubleBE(hdr.seq, offset);
            offset += 8;
        }

        write_packet_header(buf, PACKET_TYPE_DATA_ACK, nc.time, nc.rand, missing_seq, 0);
        nc.send_packet(buf, 0, offset);
    } while (nc.delayed_acks_queue.length);
}

/**
 *
 * receive_acks
 *
 */
function receive_acks(nc, hdr, buffer) {
    dbg.log1('NUDP receive_acks:',
        'count', (buffer.length - PACKET_HEADER_LEN) / 8,
        nc.connid);

    var offset = PACKET_HEADER_LEN;
    while (offset < buffer.length) {
        var seq = buffer.readDoubleBE(offset);
        offset += 8;

        var packet = nc.packets_send_wait_ack_map[seq];
        delete nc.packets_send_wait_ack_map[seq];
        if (!packet) {
            dbg.log3('NUDP receive_acks: ignore missing seq', seq, nc.connid);
            continue;
        }

        // update the packet and remove from pending send list
        packet.ack = true;
        nc.packets_send_queue.remove(packet);
        nc.packets_ack_counter += 1;

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
    var missing_packet = nc.packets_send_wait_ack_map[missing_seq];
    if (missing_packet) {
        nc.packets_send_queue.remove(missing_packet);
        nc.packets_send_queue.push_front(missing_packet);
        missing_packet.last_sent = 0;
    }

    // after receiving ACKs we trim send window to allow adding new messages,
    // and then populate the send window with more packets from pending messages.
    trim_send_window(nc);
    populate_send_window(nc);
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
        throw new Error('NUDP BAD PACKET MAGIC ' + magic);
    }
    var version = buf.readUInt16BE(4);
    if (version !== CURRENT_VERSION) {
        throw new Error('NUDP BAD PACKET VERSION ' + version);
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
