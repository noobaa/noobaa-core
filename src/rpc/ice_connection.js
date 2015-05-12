'use strict';

module.exports = IceConnection;

var _ = require('lodash');
var Q = require('q');
// var url = require('url');
var util = require('util');
var dgram = require('dgram');
var EventEmitter = require('events').EventEmitter;
var ip_module = require('ip');
var stun = require('./stun');
var dbg = require('noobaa-util/debug_module')(__filename);

util.inherits(IceConnection, EventEmitter);

/**
 *
 * IceConnection
 *
 * minimalistic implementation of ICE - https://tools.ietf.org/html/rfc5245
 * we chose a small subset of the spec to keep it simple,
 * but this module will continue to develop as we encounter more complicated networks.
 *
 */
function IceConnection(options) {
    var self = this;
    EventEmitter.call(self);
    var socket = dgram.createSocket('udp4');
    self.signaller = options.signaller;
    self.addr_url = options.addr_url;
    self.select_addr_defer = Q.defer();
    self.socket = socket;
    self.addresses = {};
    self.port = 0;

    // the socket multiplexes with stun so we receive also
    // stun messages by our listener, but the stun listener already handled
    // them so we just need to ignore it here.
    socket.on('message', function(buffer, rinfo) {
        if (stun.is_stun_packet(buffer)) {
            stun.handle_stun_packet(socket, buffer, rinfo);
        } else {
            self.emit('message', buffer, rinfo);
        }
    });

    socket.on('close', function() {
        dbg.error('ICE SOCKET CLOSED', new Error().stack);
        self.close();
    });

    // this might occur on ESRCH error from getaddrinfo() for dns resolve.
    socket.on('error', function(err) {
        dbg.error('ICE SOCKET ERROR', err.stack || err);
        self.emit('error', new Error('ICE SOCKET ERROR'));
    });

    // this is a stun response from a stun server, letting us know
    // what is our reflexive address as it sees us.
    // we keep all the addresses we discover in a map (without dups),
    // so they can be used later for contacting us from other peers.
    socket.on('stun.address', function(addr) {
        dbg.log0('ICE STUN ME', addr);
        self.addresses[addr.address + ':' + addr.port] = addr;
    });

    socket.on('stun.request', function(rinfo) {
        // we pick the first address that we get a proper request for
        if (!self.selected_addr) {
            dbg.log0('ICE READY - SELECTED ADDRESS', rinfo.address + ':' + rinfo.port);
            self.selected_addr = rinfo;
        }
        if (self.select_addr_defer) {
            self.select_addr_defer.resolve();
            self.select_addr_defer = null;
        }
    });

    // this is a stun keepalive that we receive as we are also
    // acting as a mini stun server.
    // anyhow indications are meant to be ignored.
    socket.on('stun.indication', function(rinfo) {
        dbg.log3('ICE STUN indication', rinfo.address + ':' + rinfo.port);
    });

    // this is an explicit error reply sent from stun server
    // so most likely something wrong about the protocol.
    // nothing much to do about it here since the udp socket and
    // the connections are fine, so if this occurs we need to
    // debug the stun request/response that caused it.
    socket.on('stun.error', function(rinfo) {
        dbg.warn('ICE STUN ERROR', rinfo.address + ':' + rinfo.port);
    });

    self.error_handler = function(err) {
        if (err) {
            self.emit('error', err);
        }
    };
}


/**
 *
 * _bind
 *
 */
IceConnection.prototype._bind = function() {
    var self = this;

    // bind the udp socket to requested port (can be 0 to allocate random)
    return Q.ninvoke(self.socket, 'bind', self.port)
        .then(function() {

            // update port in case it was 0 to bind to any port
            self.port = self.socket.address().port;

            // add my host address
            var ip = ip_module.address();
            self.addresses[ip] = {
                family: 'IPv4',
                address: ip,
                port: self.port
            };

            dbg.log0('ICE bind', ip, self.port);

            var stun_url = stun.STUN.DEFAULT_SERVER;

            /* TEST: send to myself...
            stun_url = {
                hostname: '127.0.0.1',
                port: self.port,
            }; */

            // connet the socket to stun server by sending stun request
            // and keep the stun mapping open after by sending indications
            // periodically.
            return stun.connect_socket(
                self.socket,
                stun_url.hostname,
                stun_url.port);
        });
};


/**
 *
 * _punch_hole
 *
 */
IceConnection.prototype._punch_hole = function(addr, attempts) {
    var self = this;
    attempts = attempts || 0;

    // we are done if address was selected
    if (self.selected_addr) {
        return;
    }
    if (attempts >= 300) {
        dbg.warn('ICE _punch_hole ADDRESS EXHAUSTED', addr);
        return;
    }
    return stun.send_request(
            self.socket,
            addr.address,
            addr.port)
        .then(null, function(err) {
            dbg.warn('ICE _punch_hole SEND STUN FAILED', addr, err.stack || err);
        })
        .then(function() {
            return Q.delay(100);
        })
        .then(function() {
            return self._punch_hole(addr, attempts + 1);
        });
};


/**
 *
 * _punch_holes
 *
 */
IceConnection.prototype._punch_holes = function(addresses) {
    var self = this;
    return Q.fcall(function() {
        dbg.log0('ICE _punch_holes addresses', addresses);
        // send stun request to each of the remote addresses
        return Q.all(_.map(addresses, self._punch_hole.bind(self)));
    })
    .then(function() {
        if (!self.selected_addr) {
            throw new Error('ICE _punch_holes EXHAUSTED');
        }
    })
    .then(null, function(err) {
        self.emit('error', err);
        throw err;
    });
};


/**
 *
 * connect
 *
 */
IceConnection.prototype.connect = function() {
    var self = this;
    if (this.selected_addr) {
        return;
    }

    return self._bind()
        .then(function() {
            // send my addresses using the signaller
            return self.signaller({
                addresses: _.values(self.addresses)
            });
        })
        .then(function(info) {
            return self._punch_holes(info.addresses);
        }, function(err) {
            self.emit('error', err);
            throw err;
        });
};


/**
 *
 * accept
 *
 */
IceConnection.prototype.accept = function(info) {
    var self = this;
    if (this.selected_addr) {
        return;
    }

    return self._bind()
        .then(function() {
            dbg.log0('ICE ACCEPT SIGNAL', info);

            // don't wait for the address selection
            // because we need to return the addresses first
            // to the sender of the signal so that it will send us
            // stun requests.
            self._punch_holes(info.addresses);

            // return my addresses over the signal
            return {
                addresses: _.values(self.addresses)
            };
        })
        .then(null, function(err) {
            self.emit('error', err);
            throw err;
        });
};


/**
 *
 * send
 *
 */
IceConnection.prototype.send = function(buffer, offset, length) {
    if (!this.selected_addr) {
        dbg.log0('ICE SOCKET NOT READY TO SEND');
        return;
    }
    this.socket.send(
        buffer,
        offset || 0,
        length || buffer.length,
        this.selected_addr.port,
        this.selected_addr.address,
        this.error_handler);
};


/**
 *
 * close
 *
 */
IceConnection.prototype.close = function() {
    this.selected_addr = null;
    if (this.closed) {
        return;
    }
    this.closed = true;
    this.socket.close();
    this.emit('close');
};
