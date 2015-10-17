'use strict';

module.exports = NudpFlow;

var _ = require('lodash');
var P = require('../util/promise');
var util = require('util');
var js_utils = require('../util/js_utils');
var time_utils = require('../util/time_utils');
var EventEmitter = require('events').EventEmitter;
var LinkedList = require('../util/linked_list');
var chance = require('chance')();
var dbg = require('../util/debug_module')(__filename);


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

var WINDOW_BYTES_MAX = 1 * 1024 * 1024;
var WINDOW_LENGTH_MAX = 1000;
var SEND_BATCH_COUNT = 20;
var SEND_RETRANSMIT_DELAY = 100000;
var ACKS_PER_SEC_MIN = 1000;
var ACK_DELAY = 1;
var SYN_ACK_DELAY = 50;
var FIN_DELAY = 500;

var RAND_SPEC = {
    min: 0,
    max: (1 << 16) * (1 << 16)
};

util.inherits(NudpFlow, EventEmitter);

/**
 *
 * NudpFlow
 *
 * udp flow control.
 * provides a reliable and ordered stream of messages of any length
 * (regardless of underlying mtu).
 *
 */
function NudpFlow(params) {
    EventEmitter.call(this);

    this.connid = params.connid;
    this.time = Date.now();
    this.rand = chance.integer(RAND_SPEC);

    // this._state = STATE_INIT;
    this._state = STATE_CONNECTED;

    // the message send queue is the first phase for sending messages,
    // and its main purpose is to maintain the buffer message boundary,
    // and a P.defer used to wakeup the caller once acknowleded.
    this._messages_send_queue = new LinkedList('m');

    // the send & receive windows holding packet objects which are being
    // transmitted over the connection, and will be marked and removed
    // when the acknowledge is received.
    this._packets_send_wait_ack_map = {};
    this._packets_send_queue = new LinkedList('s');
    this._packets_send_window = new LinkedList('w');
    this._packets_send_window_bytes = 0;
    this._packets_send_window_seq = 1;
    this._packets_ack_counter = 0;
    this._packets_ack_counter_last_val = 0;
    this._packets_ack_counter_last_time = 0;
    this._packets_retrasmits = 0;
    this._packets_retrasmits_last_val = 0;
    this._send_packets_report_last_time = 0;

    this._packets_receive_window_seq = 1;
    this._packets_receive_window_map = {};
    this._packets_receive_message_buffers = [];
    this._packets_receive_message_bytes = 0;

    this._delayed_syn_ack_timeout = null;
    this._delayed_fin_timeout = null;
    this._delayed_acks_queue = new LinkedList('a');

    this._mtu_min = MTU_MIN;
    this._mtu_max = MTU_MAX;
    this._mtu = MTU_DEFAULT;

    // override prototype functions with their self bind versions
    // to avoid repeated binds during the flow
    // for example to make such calls - setTimeout(this._send_packets, 1000)
    js_utils.self_bind(this, [
        '_send_packets',
        '_send_syn_ack',
        '_send_fin',
        '_send_delayed_acks',
    ]);
}

/**
 *
 * send
 *
 */
NudpFlow.prototype.send = function(buffer) {
    var msg_length = _.sum(buffer, 'length');
    if (msg_length <= 0) {
        throw new Error('NUDP cannot send empty message');
    }
    var send_defer = P.defer();
    this._messages_send_queue.push_back({
        send_defer: send_defer,
        buffer: buffer,
        remain: msg_length,
        num_packets: 0,
        acked_packets: 0,
    });
    this._populate_send_window();
    return send_defer.promise;
};


/**
 *
 * recvmsg
 *
 * should be called whenever a packet is received from the socket,
 * this will decode and handle the packet type.
 *
 */
NudpFlow.prototype.recvmsg = function(buffer) {
    var hdr = read_packet_header(buffer);

    dbg.log2('NUDP recvmsg:',
        'type', hdr.type,
        'seq', hdr.seq,
        'connid', this.connid);

    if (this._state === STATE_CLOSED) {
        dbg.warn('NUDP recvmsg: connection is closed, send FIN connid', this.connid);
        this._schedule_delayed_fin();
        return;
    }

    switch (hdr.type) {
        case PACKET_TYPE_SYN:
            this._receive_syn(hdr);
            break;
        case PACKET_TYPE_SYN_ACK:
            this._receive_syn_ack(hdr);
            break;
        case PACKET_TYPE_FIN:
            this._receive_fin(hdr);
            break;
        case PACKET_TYPE_DATA:
            this._receive_data_packet(hdr, buffer);
            break;
        case PACKET_TYPE_DATA_ACK:
            this._receive_acks(hdr, buffer);
            break;
        default:
            dbg.error('NUDP recvmsg BAD PACKET TYPE', hdr, 'connid', this.connid);
            break;
    }
};


/**
 *
 */
NudpFlow.prototype.close = function() {

    // send fin message to other end
    if (this._state !== STATE_CLOSED) {
        this._schedule_delayed_fin();
    }

    // wakeup if anyone is waiting for connect
    close_defer(this, 'connect_defer');

    // clear the messages queue
    var message = this._messages_send_queue.pop_front();
    while (message) {
        close_defer(message, 'send_defer');
        message = this._messages_send_queue.pop_front();
    }

    // clear the packets send queue
    var packet = this._packets_send_queue.pop_front();
    while (packet) {
        close_defer(packet.message, 'send_defer');
        packet = this._packets_send_queue.pop_front();
    }

    // clear the send window packets
    packet = this._packets_send_window.pop_front();
    while (packet) {
        packet = this._packets_send_window.pop_front();
    }

    // clear the delayed acks queue
    var hdr = this._delayed_acks_queue.pop_front();
    while (hdr) {
        hdr = this._delayed_acks_queue.pop_front();
    }

    this._state = STATE_CLOSED;
};


function close_defer(container, name) {
    if (container[name]) {
        container[name].reject('NUDP disconnect');
        container[name] = null;
    }
}



/**
 *
 * _trim_send_window
 *
 * "trim left" acknowledged packets from the window
 *
 */
NudpFlow.prototype._trim_send_window = function() {
    var packet = this._packets_send_window.get_front();
    while (packet && packet.ack) {
        dbg.log2('NUDP _trim_send_window: seq', packet.seq, this.connid);
        this._packets_send_window_bytes -= packet.len;
        this._packets_send_window.pop_front();
        packet = this._packets_send_window.get_front();
    }
    dbg.log0('NUDP _trim_send_window: front seq', packet && packet.seq,
        'len', this._packets_send_window.length, this.connid);
};


/**
 *
 * _populate_send_window
 *
 * fill the send window from the message send queue.
 * this is bit heavy work of cpu/memory due to buffer copying.
 *
 */
NudpFlow.prototype._populate_send_window = function() {
    dbg.log0('NUDP _populate_send_window:',
        'len', this._packets_send_window.length,
        'bytes', this._packets_send_window_bytes,
        this.connid);
    var populated = 0;
    while (this._packets_send_window.length < WINDOW_LENGTH_MAX &&
        this._packets_send_window_bytes < WINDOW_BYTES_MAX) {
        var message = this._messages_send_queue.get_front();
        if (!message) {
            break;
        }
        var buf = new Buffer(this._mtu || this._mtu_min);
        var packet_remain = buf.length - PACKET_HEADER_LEN;
        var payload_len = Math.min(packet_remain, message.remain);
        var packet_len = PACKET_HEADER_LEN + payload_len;
        var flags = 0;
        if (packet_remain >= message.remain) {
            flags |= PACKET_FLAG_BOUNDARY_END;
        }
        var seq = this._packets_send_window_seq;
        var packet = {
            seq: seq,
            buffer: buf,
            len: packet_len,
            transmits: 0,
            last_sent: 0,
            message: message
        };
        write_packet_header(buf, PACKET_TYPE_DATA, this.time, this.rand, seq, flags);
        if (message.remain > 0) {
            if (_.isArray(message.buffer)) {
                var payload_offset = 0;
                var payload_remain = payload_len;
                while (payload_remain > 0) {
                    var msg_buf = message.buffer[0];
                    if (msg_buf.length <= payload_remain) {
                        msg_buf.copy(buf, PACKET_HEADER_LEN + payload_offset, 0, msg_buf.length);
                        payload_offset += msg_buf.length;
                        payload_remain -= msg_buf.length;
                        message.buffer.shift();
                    } else {
                        msg_buf.copy(buf, PACKET_HEADER_LEN + payload_offset, 0, payload_remain);
                        message.buffer[0] = msg_buf.slice(payload_remain);
                        payload_offset += payload_remain;
                        payload_remain = 0;
                    }
                }
            } else {
                message.buffer.copy(buf, PACKET_HEADER_LEN, 0, payload_len);
                message.buffer = message.buffer.slice(payload_len);
            }
        }
        message.num_packets += 1;
        message.remain -= payload_len;
        if (message.remain <= 0) {
            this._messages_send_queue.remove(message);
            message.populated = true;
        }
        populated += 1;
        this._packets_send_wait_ack_map[seq] = packet;
        // this._packets_send_queue.push_back(packet);
        this._packets_send_window.push_back(packet);
        this._packets_send_window_seq += 1;
        this._packets_send_window_bytes += packet_len;
        dbg.log2('NUDP _populate_send_window: seq', packet.seq, this.connid);
    }

    if (populated) {
        // wakeup sender if sleeping
        if (!this._process_send_immediate && !this._process_send_timeout) {
            this._process_send_immediate = setImmediate(this._send_packets);
        }
    }
};


/**
 *
 * _send_packets
 *
 */
NudpFlow.prototype._send_packets = function() {
    clearTimeout(this._process_send_timeout);
    clearImmediate(this._process_send_immediate);
    this._process_send_timeout = null;
    this._process_send_immediate = null;

    if (this._state !== STATE_CONNECTED) {
        this.emit('error', new Error('NUDP not connected'));
        return;
    }
    if (!this._packets_send_window.length) {
        return;
    }
    dbg.log0('NUDP _send_packets:',
        'length', this._packets_send_window.length,
        this.connid);

    var now = Date.now();
    var last_send_thres = now - SEND_RETRANSMIT_DELAY;
    var batch_count = 0;
    // var send_delay = 0;
    var packet = this._packets_send_window.get_front();
    // var last_packet = this._packets_send_queue.get_back();
    while (packet && batch_count < SEND_BATCH_COUNT) {

        // resend packets only if last send was above a threshold
        // send_delay = now - packet.last_sent;
        if (!packet.ack && (packet.nacks > 3 || packet.last_sent < last_send_thres)) {
            packet.transmits += 1;
            if (packet.transmits > 1) {
                dbg.log0('NUDP _send_packets:',
                    'seq', packet.seq,
                    'len', packet.len,
                    'transmits', packet.transmits,
                    this.connid);
                this._packets_retrasmits += 1;
            }
            packet.last_sent = now;
            batch_count += 1;
            this._send_packet(packet.buffer, 0, packet.len);
        }

        // move packet to end of the send queue
        // keep the next packet so we keep iterating even when we mutate the list
        var next_packet = this._packets_send_window.get_next(packet);
        // this._packets_send_queue.remove(packet);
        // this._packets_send_queue.push_back(packet);
        // stop once completed cycle on all packets
        // if (packet === last_packet) {
            // break;
        // }
        packet = next_packet;
    }

    var secstamp = time_utils.secstamp();
    var dt = secstamp - this._packets_ack_counter_last_time;
    var num_acks = this._packets_ack_counter - this._packets_ack_counter_last_val;
    var acks_per_sec = num_acks / dt;
    var num_retrans = this._packets_retrasmits - this._packets_retrasmits_last_val;
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
    if (secstamp - this._send_packets_report_last_time >= 1) {
        dbg.log0('NUDP _send_packets:',
            'num_acks', num_acks,
            'acks_per_sec', acks_per_sec.toFixed(2),
            'retrans_per_sec', retrans_per_sec.toFixed(2),
            'ms_per_batch', ms_per_batch.toFixed(2),
            this.connid);
        this._send_packets_report_last_time = secstamp;
    // }

    // update the saved values once in fixed intervals
    // if (dt >= 0.03) {
        this._packets_ack_counter_last_time = secstamp;
        this._packets_ack_counter_last_val = this._packets_ack_counter;
        this._packets_retrasmits_last_val = this._packets_retrasmits;
    }

    // schedule next send according to calculated rate
    // a small minimum number of milliseconds is needed for setTiemout
    // because the timer will not be able to wake us up in sub milli times,
    // so for higher rates we use setImmediate, but that will leave less
    // cpu time for other tasks...
    // send_delay = Math.max(send_delay, ms_per_batch);
    if (ms_per_batch > 5) {
        this._process_send_timeout =
            setTimeout(this._send_packets, ms_per_batch);
    } else {
        this._process_send_immediate =
            setImmediate(this._send_packets);
    }
};


/**
 *
 * _send_packet
 *
 */
NudpFlow.prototype._send_packet = function(buffer, offset, length) {
    this.emit('sendmsg', buffer, offset, length);
};


/**
 *
 * _send_syn
 *
 */
NudpFlow.prototype._send_syn = function() {
    var self = this;
    var syn_buf = new Buffer(PACKET_HEADER_LEN);
    var attempt = 0;
    var timer;
    next_attempt();

    function next_attempt() {
        attempt += 1;
        clearTimeout(timer);
        dbg.log0('NUDP _send_syn:',
            'state', self._state,
            'attempt', attempt,
            self.connid);

        // if state is not init we are done trying to SYN -
        // might be connected or closed already.
        if (self._state !== STATE_INIT) {
            return;
        }

        // limit attempts
        if (attempt > SYN_ATTEMPTS) {
            self.emit('error', new Error('NUDP _send_syn: connect exhuasted ' + self.connid));
            return;
        }

        // send the SYN attempt sequence over the hdr.seq field
        write_packet_header(syn_buf, PACKET_TYPE_SYN, self.time, self.rand, attempt, 0);
        self._send_packet(syn_buf);
        timer = setTimeout(next_attempt, SYN_ATTEMPT_DELAY);
    }
};

/**
 *
 * _receive_syn
 *
 */
NudpFlow.prototype._receive_syn = function(hdr) {
    dbg.log0('NUDP _receive_syn:',
        'state', this._state,
        'syn seq', hdr.seq,
        this.connid);

    switch (this._state) {
        case STATE_INIT:
            this._state = STATE_CONNECTED;
            if (this._connect_defer) {
                this._connect_defer.resolve();
                this._connect_defer = null;
            }
            this._schedule_delayed_syn_ack(hdr);
            break;
        case STATE_CONNECTED:
            this._schedule_delayed_syn_ack(hdr);
            break;
        default:
            break;
    }
};


/**
 *
 * _schedule_delayed_syn_ack
 *
 */
NudpFlow.prototype._schedule_delayed_syn_ack = function(hdr) {
    if (!this._delayed_syn_ack_timeout) {
        this._delayed_syn_ack_timeout =
            setTimeout(this._send_syn_ack, SYN_ACK_DELAY, hdr);
    }
};

/**
 *
 * _send_syn_ack
 *
 */
NudpFlow.prototype._send_syn_ack = function(hdr) {
    dbg.log0('NUDP _send_syn_ack:',
        'state', this._state,
        'attempt', hdr.seq,
        this.connid);

    var syn_ack_buf = new Buffer(PACKET_HEADER_LEN);
    write_packet_header(syn_ack_buf, PACKET_TYPE_SYN_ACK, this.time, this.rand, hdr.seq, 0);
    this._send_packet(syn_ack_buf);

    clearTimeout(this._delayed_syn_ack_timeout);
    this._delayed_syn_ack_timeout = null;
};


/**
 *
 * _receive_syn_ack
 *
 */
NudpFlow.prototype._receive_syn_ack = function(hdr) {
    dbg.log0('NUDP _receive_syn_ack:',
        'state', this._state,
        'attempt', hdr.seq,
        this.connid);

    switch (this._state) {
        case STATE_INIT:
            this._state = STATE_CONNECTED;
            if (this._connect_defer) {
                this._connect_defer.resolve();
                this._connect_defer = null;
            }
            break;
        default:
            break;
    }
};


/**
 *
 * _schedule_delayed_fin
 *
 */
NudpFlow.prototype._schedule_delayed_fin = function() {
    if (!this._delayed_fin_timeout) {
        this._delayed_fin_timeout =
            setTimeout(this._send_fin, FIN_DELAY);
    }
};


/**
 *
 * _send_fin
 *
 */
NudpFlow.prototype._send_fin = function() {
    dbg.log0('NUDP _send_fin:',
        'state', this._state,
        this.connid);

    var fin_buf = new Buffer(PACKET_HEADER_LEN);
    write_packet_header(fin_buf, PACKET_TYPE_FIN, this.time, this.rand, 0, 0);
    this._send_packet(fin_buf);

    clearTimeout(this._delayed_fin_timeout);
    this._delayed_fin_timeout = null;
};


/**
 *
 * _receive_fin
 *
 */
NudpFlow.prototype._receive_fin = function(hdr) {
    dbg.log0('NUDP _receive_fin:',
        'state', this._state,
        this.connid);
    this.close();
};


/**
 *
 * _receive_data_packet
 *
 */
NudpFlow.prototype._receive_data_packet = function(hdr, buffer) {
    var add_to_acks_queue = true;

    if (hdr.seq > this._packets_receive_window_seq + WINDOW_LENGTH_MAX) {

        // checking if the received sequence is out of the window length
        // TODO reply with NEGATIVE ACK ?

        dbg.log0('NUDP _receive_data_packet:',
            'drop seq out of window', hdr.seq,
            'window seq', this._packets_receive_window_seq,
            this.connid);
        add_to_acks_queue = false;

    } else if (hdr.seq < this._packets_receive_window_seq) {

        // checking if the received sequence is old, and then drop it.
        // this case means we get dup packets.
        // we still send an ack for this packet to help release the sender.
        // TODO reply with DUP ACK ?

        dbg.log0('NUDP _receive_data_packet:',
            'drop old seq', hdr.seq,
            'window seq', this._packets_receive_window_seq,
            this.connid);

    } else {

        var packet = {
            hdr: hdr,
            payload: buffer.slice(PACKET_HEADER_LEN)
        };

        if (hdr.seq === this._packets_receive_window_seq) {
            do {

                // when we get the next packet we waited for we can collapse
                // the window of the next queued packets as well, and join them
                // to the received message.
                dbg.log2('NUDP _receive_data_packet:',
                    'pop from window seq', packet.hdr.seq,
                    this.connid);
                delete this._packets_receive_window_map[this._packets_receive_window_seq];
                this._packets_receive_message_buffers.push(packet.payload);
                this._packets_receive_message_bytes += packet.payload.length;
                this._packets_receive_window_seq += 1;

                // checking if this packet is a message boundary packet
                // and in that case we extract it and emit to the connection.
                if (packet.hdr.flags & PACKET_FLAG_BOUNDARY_END) {
                    var msg = Buffer.concat(
                        this._packets_receive_message_buffers,
                        this._packets_receive_message_bytes);
                    this._packets_receive_message_buffers.length = 0;
                    this._packets_receive_message_bytes = 0;
                    this.emit('message', msg);
                }
                packet = this._packets_receive_window_map[this._packets_receive_window_seq];
            } while (packet);

        } else {

            // if the packet is not the next awaited sequence,
            // then we save it for when that missing seq arrives
            dbg.log2('NUDP _receive_data_packet:',
                'push to window seq', hdr.seq,
                'wait for seq', this._packets_receive_window_seq,
                this.connid);
            this._packets_receive_window_map[hdr.seq] = packet;
        }
    }


    // queue a delayed ack
    if (add_to_acks_queue) {
        this._delayed_acks_queue.push_back(hdr);
    }
    if (!this._delayed_acks_timeout) {
        this._delayed_acks_timeout =
            setTimeout(this._send_delayed_acks, ACK_DELAY);
    }
};


/**
 *
 * _send_delayed_acks
 *
 */
NudpFlow.prototype._send_delayed_acks = function() {
    var missing_seq = this._packets_receive_window_seq;
    dbg.log1('NUDP _send_delayed_acks:',
        'count', this._delayed_acks_queue.length,
        'missing_seq', missing_seq,
        this.connid);

    clearTimeout(this._delayed_acks_timeout);
    this._delayed_acks_timeout = null;

    // send at least one ACK packet even if the queue is empty,
    // in order to send the missing_seq.
    do {
        var buf = new Buffer(this._mtu || this._mtu_min);
        var offset = PACKET_HEADER_LEN;

        // fill the buffer with list of acks.
        while (offset < buf.length && this._delayed_acks_queue.length) {
            var hdr = this._delayed_acks_queue.pop_front();
            buf.writeDoubleBE(hdr.seq, offset);
            offset += 8;
        }

        write_packet_header(buf, PACKET_TYPE_DATA_ACK, this.time, this.rand, missing_seq, 0);
        this._send_packet(buf, 0, offset);
    } while (this._delayed_acks_queue.length);
};

/**
 *
 * _receive_acks
 *
 */
NudpFlow.prototype._receive_acks = function(hdr, buffer) {
    dbg.log1('NUDP _receive_acks:',
        'count', (buffer.length - PACKET_HEADER_LEN) / 8,
        this.connid);

    var offset = PACKET_HEADER_LEN;
    while (offset < buffer.length) {
        var seq = buffer.readDoubleBE(offset);
        offset += 8;

        var packet = this._packets_send_wait_ack_map[seq];
        delete this._packets_send_wait_ack_map[seq];
        if (!packet) {
            dbg.log3('NUDP _receive_acks: ack seq already gone', seq, this.connid);
            continue;
        }

        // update the packet and remove from pending send list
        packet.ack = true;
        // this._packets_send_queue.remove(packet);
        this._packets_ack_counter += 1;

        // check if this ack is the last ACK waited by this message,
        // and wakeup the sender.
        packet.message.acked_packets += 1;
        if (packet.message.remain <= 0 &&
            packet.message.acked_packets === packet.message.num_packets) {
            packet.message.send_defer.resolve();
            packet.message.send_defer = null;
        }
    }

    // for the missing packet we force resend
    var missing_seq = hdr.seq;
    if (missing_seq + this._packets_send_window.length < this._packets_send_window_seq) {
        dbg.error('NUDP _receive_acks: missing seq too old', missing_seq,
            'window seq', this._packets_send_window_seq, this.connid);
        // this.emit('error', new Error('NUDP _receive_acks: missing seq too old'));
    }
    var missing_packet = this._packets_send_wait_ack_map[missing_seq];
    if (missing_packet) {
        // this._packets_send_queue.remove(missing_packet);
        // this._packets_send_queue.push_front(missing_packet);
        missing_packet.nacks = (missing_packet.nacks || 0) + 1;
    }

    // after receiving ACKs we trim send window to allow adding new messages,
    // and then populate the send window with more packets from pending messages.
    this._trim_send_window();
    this._populate_send_window();
};


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
