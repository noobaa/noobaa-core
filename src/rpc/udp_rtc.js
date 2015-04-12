'use strict';

var _ = require('lodash');
var dgram = require('dgram');
var stun = require('stun');
var EventEmitter = require('events').EventEmitter;

/**
 *
 * this module provides an api like webrtc but simply uses stun and udp socket instead.
 *
 */
module.exports = {
    RTCIceCandidate: RTCIceCandidate,
    RTCPeerConnection: RTCPeerConnection,
    RTCSessionDescription: RTCSessionDescription,
};


/**
 *
 */
function RTCPeerConnection(config) {
    this._config = config;
    this._dc = {};
    this._ev = new EventEmitter();

    var url = config.iceServers[0].url.split(':');
    var port = url[2] || (url[0] === 'stuns' ? 5349 : 3478);
    var host = url[1];
    console.log('RTC STUN CONNECT', host, port);
    this._stun = stun.connect(port, host);
    this._stun.on('error', function(err) {
        console.error('RPC STUN ERROR', err);
    });
    this._stun.on('response', this._on_stun_response.bind(this));
    this._stun.on('message', this._on_stun_message.bind(this));
    this._stun.request(function() {
        console.log('RTC STUN REQUEST');
    });
}


/**
 *
 */
RTCPeerConnection.prototype.createDataChannel = function(channel_name) {
    var dc = this._dc[channel_name];
    if (!dc) {
        // make a header
        dc = this._dc[channel_name] = new DataChannel(this, channel_name);
    }
    return dc;
};

/**
 *
 */
RTCPeerConnection.prototype.setLocalDescription = function(description, resolve, reject) {
    this.localDescription = description;
    if (resolve) resolve();
};

/**
 *
 */
RTCPeerConnection.prototype.setRemoteDescription = function(description, resolve, reject) {
    this.remoteDescription = description;
    if (resolve) resolve();
};

/**
 *
 */
RTCPeerConnection.prototype.addIceCandidate = function(candidate, resolve, reject) {
    console.log('RTC CANDIDATE', candidate);
    this._peer_nat = candidate;

    this.iceConnectionState = 'connected';
    if (this.oniceconnectionstatechange) {
        this.oniceconnectionstatechange();
    }

    _.each(this._dc, function(dc) {
        if (dc.onopen) {
            dc.onopen();
        }
    });

    if (resolve) resolve();
};

/**
 *
 */
RTCPeerConnection.prototype.createOffer = function(callback) {
    callback({
        sdp: 'SHUM-KLUM'
    });
};

/**
 *
 */
RTCPeerConnection.prototype.createAnswer = function(callback) {
    callback({});
};





/**
 * STUN response event handler
 */
RTCPeerConnection.prototype._on_stun_response = function(packet) {
    console.log('RTC STUN RESPONSE', packet);
    this._nat = packet.attrs[stun.attribute.MAPPED_ADDRESS];
    this._sock = dgram.createSocket('udp4');
    this._sock.on('message', this._stun._onMessage());
    this._sock.on('error', this._stun._onError());
    this._sock.bind(this._nat.port);
    if (this.onicecandidate) {
        this.onicecandidate({
            candidate: this._nat
        });
    }
};


RTCPeerConnection.prototype._on_stun_message = function(buffer, remote_info) {
    var header_end = buffer.readUInt16BE(2);
    var header = JSON.parse(buffer.slice(4, header_end));
    console.log('RTC MESSAGE HEADER', header, buffer.length, header_end);
    var channel_name = header.c;
    var dc = this._dc[channel_name];
    if (!dc) {
        dc = this.createDataChannel(channel_name);
        if (this.ondatachannel) {
            this.ondatachannel({
                channel: dc
            });
        }
        if (dc.onopne) {
            dc.onopen();
        }
    }
    if (dc.onmessage) {
        dc.onmessage({
            data: buffer.slice(header_end)
        });
    }
};



/**
 *
 */
function DataChannel(pc, name) {
    this._pc = pc;
    this._name = name;
    var header = {
        c: name
    };
    var header_buffer = Buffer.concat([new Buffer(4), new Buffer(JSON.stringify(header))]);
    header_buffer.writeUInt16BE(0xffff, 0); // just something to not be detected as stun
    header_buffer.writeUInt16BE(header_buffer.length, 2);
    this._bufs = [header_buffer, null];
}

DataChannel.prototype.send = function(data) {
    this._bufs[1] = Buffer.isBuffer(data) ? data : new Buffer(new Uint8Array(data));
    var buffer = Buffer.concat(this._bufs);
    var sock = this._pc._stun;
    var peer = this._pc._peer_nat;
    // console.log('SEND', buffer.length);
    this.bufferedAmount += buffer.length;
    sock.send(
        buffer, 0, buffer.length,
        peer.port, '127.0.0.1' || peer.address,
        socket_send_callback);
};


function socket_send_callback(err) {
    if (err) {
        console.error('RTC SEND ERROR', err);
    }
}






/**
 * just passing the data to the peer connection
 */
function RTCSessionDescription(data) {
    return data;
}

/**
 * just passing the data to the peer connection
 */
function RTCIceCandidate(data) {
    return data;
}
