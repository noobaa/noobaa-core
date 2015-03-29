/* jshint browser:true */
'use strict';

var debug = require('debug');
debug.disable("*");
// debug.enable("*");

var Peer = require('simple-peer');
var Q = require('q');
var _ = require('lodash');
var WebSock = require('ws');

var ws;
var peers = {};
var running = true;
var monitor_interval = setInterval(monitor, 1000);

var state = {
    throttled: false,
    sseq: 0,
    rseq: 0,
    send: {
        count: 0,
        bytes: 0,
        delays: 0,
    },
    receive: {
        count: 0,
        bytes: 0,
    },
    time: Date.now()
};

var THROTTLE_HIGH = 0;
var THROTTLE_LOW = 0;

console.log('LETS GO!');

connect();





/**
 *
 */
function connect() {
    if (ws) return;
    var url = 'ws://localhost:5999/ws';
    if (typeof(window) !== 'undefined' && window.location) {
        var proto = location.protocol.replace('https:', 'wss:').replace('http:', 'ws:');
        url = proto + '//' + location.host + '/ws';
    }
    ws = new WebSock(url);
    ws.onopen = function() {
        console.log('WS opened');
    };
    ws.onclose = function() {
        console.error('WS closed');
    };
    ws.onerror = function(err) {
        console.error('WS error', err);
    };
    ws.onmessage = function(event) {
        var msg = JSON.parse(event.data);
        console.log('WS message', msg);
        if (msg.type === 'ready') {
            init_peer(msg);
        } else if (msg.type === 'signal') {
            handle_signal_message(msg);
        }
    };
    ws.signal = function(from_id, to_id, data) {
        console.log('WS signal from', from_id, 'to', to_id);
        ws.send(JSON.stringify({
            type: 'signal',
            from_id: from_id,
            to_id: to_id,
            data: data
        }));
    };
    ws.ready = function() {
        console.log('WS ready');
        ws.send(JSON.stringify({
            type: 'ready',
        }));
    };
}



function handle_signal_message(msg) {
    var peer = peers[msg.to_id];
    if (peer) {
        peer.signal(msg.data);
    }
}


/**
 *
 */
function init_peer(msg) {
    if (!running) return;

    console.log('PEER init');
    var peer = new Peer({
        initiator: msg.initiator,
        config: {
            // we use ordered channel to verify order of received sequences
            ordered: true,

            // default channel config is reliable
            // passing either maxRetransmits or maxPacketLifeTime will
            // set to unreliable mode (cant pass both).
            // maxRetransmits: 0,
            // maxPacketLifeTime: 3000,

            iceServers: [{
                url: 'stun:23.21.150.121'
            }]
        }
    });

    peer.from_id = msg.from_id;
    peer.to_id = msg.to_id;
    peer.initiator = msg.initiator;
    peers[msg.from_id] = peer;

    peer.on('connect', function() {
        console.log('PEER connected');
        run_test(peer);
    });
    peer.on('close', function() {
        console.error('PEER closed');
        delete peers[msg.from_id];
        ws.ready();
    });
    peer.on('error', function(err) {
        console.error('PEER error', err);
    });
    peer.on('signal', function(data) {
        ws.signal(msg.from_id, msg.to_id, data);
    });
    peer.on('data', function(data) {
        var buf = new Buffer(data);
        var rseq = buf.readUInt32BE(0);
        if (state.rseq !== rseq) {
            console.error('BAD SEQUENCE', state.rseq, rseq);
            // running = false;
            // peer.emit('error', new Error('BAD SEQUENCE ' + state.rseq + ' !== ' + rseq));
            // return;
        }
        state.rseq += 1;
        state.receive.count += 1;
        state.receive.bytes += buf.length;
    });
}



/**
 *
 */
function run_test(peer) {
    if (!running) return;
    if (!peer.initiator) return;

    console.log('PEER test');
    return Q.fcall(function() {
            return send_request(peer, 256 * 1024 * 1024);
        })
        .then(null, function(err) {
            console.error('PEER test failed', err);
        })
        .delay(1000)
        .then(function() {
            console.log('closing peer and loop');
            peer.destroy();
        });
}



/**
 *
 */
function send_request(peer, request_size) {
    if (!running) return;
    if (request_size <= 0) return;

    function retry() {
        return send_request(peer, request_size);
    }

    return Q.fcall(function() {
        // wait until channel is created
        if (!peer._channel) {
            return Q.delay(1000).then(retry);
        }

        // while channel has buffered amount, wait to let it drain
        // see https://code.google.com/p/webrtc/issues/detail?id=3123
        if (peer._channel.bufferedAmount > THROTTLE_HIGH ||
            (state.throttled && peer._channel.bufferedAmount > THROTTLE_LOW)) {
            state.throttled = true;
            state.send.delays += 1;
            return Q.delay(10).then(retry);
        } else {
            state.throttled = false;
        }

        var buf_size = 16 * 1024;
        state.send.count += 1;
        state.send.bytes += buf_size;
        return send_buffer(peer, buf_size, state.sseq++).then(function() {
            return send_request(peer, request_size - buf_size);
        });
    });
}



/**
 *
 */
function send_buffer(peer, buf_size, seq) {
    var test_buffer = new Buffer(buf_size);
    test_buffer.writeUInt32BE(seq, 0);
    return Q.nfcall(peer.send.bind(peer), toArrayBuffer(test_buffer));
}


/**
 *
 */
function monitor() {
    if (_.isEmpty(peers)) return;

    if (state.error && state.error !== state.last_error) {
        append_log('ERROR - ' + state.error.toString());
        state.last_error = state.error;
    }

    var now = Date.now();
    var dt = (now - state.time) / 1000;
    append_log(
        'SEND - ' + speed(state.send.bytes / 1024, dt) +
        ' KB/s (' + speed(state.send.count, dt) + ' messages, ' +
        speed(state.send.delays, dt) + ' delays) ' +
        'RECEIVE - ' + speed(state.receive.bytes / 1024, dt) +
        ' KB/s (' + speed(state.receive.count, dt) + ' messages) ' +
        _.map(peers, function(peer) {
            return peer.from_id + '-bufferedAmount ' + (peer && peer._channel && peer._channel.bufferedAmount || 0);
        }).join(' '));

    state.send.count = 0;
    state.send.bytes = 0;
    state.send.delays = 0;
    state.receive.count = 0;
    state.receive.bytes = 0;
    state.time = now;
}


/**
 *
 */
function append_log(text) {
    var now = new Date();
    if (typeof(window) !== 'undefined' && window.document) {
        var log_div = document.getElementById('log');
        var p = document.createElement('p');
        p.appendChild(document.createTextNode(now.toISOString() + ': ' + text));
        log_div.insertBefore(p, log_div.firstChild);
        while (log_div.childNodes.length > 50) {
            log_div.removeChild(log_div.lastChild);
        }
    } else {
        console.log(now.toISOString() + ': ' + text);
    }
}

function speed(x, dt) {
    return (x / dt).toFixed(1);
}


function toArrayBuffer(buffer) {
    if (buffer.toArrayBuffer) return buffer.toArrayBuffer();
    var ab = new ArrayBuffer(buffer.length);
    var view = new Uint8Array(ab);
    for (var i = 0; i < buffer.length; ++i) {
        view[i] = buffer[i];
    }
    return ab;
}
