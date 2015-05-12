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
var chance = require('chance').Chance();
var dbg = require('noobaa-util/debug_module')(__filename);

var RAND_ICE_CHAR_POOL =
    'abcdefghijklmnopqrstuvwxyz' +
    'ABCDEFGHIJKLMNOPQRTTUVWXYZ' +
    '0123456789+/';
var RAND_ICE_UFRAG = {
    length: 4,
    pool: RAND_ICE_CHAR_POOL
};
var RAND_ICE_PWD = {
    length: 22,
    pool: RAND_ICE_CHAR_POOL
};

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
    self.credentials = {
        ufrag: chance.string(RAND_ICE_UFRAG),
        pwd: chance.string(RAND_ICE_PWD),
    };

    // the socket multiplexes with stun so we receive also
    // stun messages by our listener, but the stun listener already handled
    // them so we just need to ignore it here.
    socket.on('message', function(buffer, rinfo) {
        if (stun.is_stun_packet(buffer)) {
            self._handle_stun_packet(buffer, rinfo);
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

    self.error_handler = function(err) {
        if (err) {
            self.emit('error', err);
        }
    };
}

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
    if (self.connect_promise) {
        return self.connect_promise;
    }

    self.connect_promise = self._bind()
        .then(function() {

            // send my info using the signaller
            return self.signaller({
                credentials: self.credentials,
                addresses: _.values(self.addresses)
            });
        })
        .then(function(info) {

            // punch hole using the remote info returned from the signal call
            self.remote_info = info;
            return self._punch_holes();

        }, function(err) {
            self.emit('error', err);
            throw err;
        })
        .fin(function() {
            self.connect_promise = null;
        });

    return self.connect_promise;
};


/**
 *
 * accept
 *
 */
IceConnection.prototype.accept = function(info) {
    var self = this;
    self.remote_info = info;
    if (this.selected_addr) {
        return;
    }
    if (self.accept_promise) {
        return self.accept_promise;
    }

    self.accept_promise = self._bind()
        .then(function() {

            // don't wait for the address selection
            // because we need to return the addresses first
            // to the sender of the signal so that it will send us
            // stun requests.
            self._punch_holes();

            // return my addresses over the signal
            return {
                credentials: self.credentials,
                addresses: _.values(self.addresses)
            };
        })
        .then(null, function(err) {
            self.emit('error', err);
            throw err;
        })
        .fin(function() {
            self.accept_promise = null;
        });

    return self.accept_promise;
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




/**
 *
 * _bind
 *
 */
IceConnection.prototype._bind = function() {
    var self = this;
    var stun_url = stun.STUN.DEFAULT_SERVER;

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

            dbg.log0('ICE bind', ip + ':' + self.port);

            // connet the socket to stun server by sending stun request
            // and keep the stun mapping open after by sending indications
            // periodically.
            return stun.send_request(
                self.socket,
                stun_url.hostname,
                stun_url.port);
        })
        .then(function() {
            stun.indication_loop(
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
IceConnection.prototype._punch_hole = function(credentials, addr, attempts) {
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
    var buffer = stun.new_packet(stun.STUN.METHODS.REQUEST, [{
        type: stun.STUN.ATTRS.USERNAME,
        value: credentials.ufrag + ':' + self.credentials.ufrag
    }, {
        type: stun.STUN.ATTRS.PASSWORD_OLD,
        value: credentials.pwd
    }]);
    return Q.ninvoke(self.socket, 'send',
            buffer, 0, buffer.length,
            addr.port, addr.address)
        .then(null, function(err) {
            dbg.warn('ICE _punch_hole SEND STUN FAILED', addr, err.stack || err);
        })
        .then(function() {
            // TODO implement ICE scheduling https://tools.ietf.org/html/rfc5245#page-37
            return Q.delay(100);
        })
        .then(function() {
            return self._punch_hole(credentials, addr, attempts + 1);
        });
};


/**
 *
 * _punch_holes
 *
 */
IceConnection.prototype._punch_holes = function() {
    var self = this;
    return Q.fcall(function() {
            dbg.log0('ICE _punch_holes REMOTE INFO', self.remote_info);
            // send stun request to each of the remote addresses
            return Q.all(_.map(self.remote_info.addresses,
                self._punch_hole.bind(self, self.remote_info.credentials)));
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
 * _handle_stun_packet
 *
 */
IceConnection.prototype._handle_stun_packet = function(buffer, rinfo) {
    var method = stun.get_method_field(buffer);
    switch (method) {
        case stun.STUN.METHODS.INDICATION:
            // indication = keepalives
            dbg.log3('ICE STUN indication', rinfo.address + ':' + rinfo.port);
            break;
        case stun.STUN.METHODS.ERROR:
            // most likely a problem in the request we sent.
            dbg.warn('ICE STUN ERROR', rinfo.address + ':' + rinfo.port);
            break;
        case stun.STUN.METHODS.REQUEST:
            this._handle_stun_request(buffer, rinfo);
            break;
        case stun.STUN.METHODS.SUCCESS:
            this._handle_stun_response(buffer, rinfo);
            break;
        default:
            break;
    }
};


/**
 *
 * _handle_stun_request
 *
 */
IceConnection.prototype._handle_stun_request = function(buffer, rinfo) {
    var attr_map = this._check_stun_credentials(buffer);
    if (!attr_map) {
        return;
    }

    // we pick the first address that we get a proper request for
    this._select_remote_address(rinfo);

    // send response
    var reply = stun.new_packet(stun.STUN.METHODS.SUCCESS, [{
        type: stun.STUN.ATTRS.XOR_MAPPED_ADDRESS,
        value: {
            family: 'IPv4',
            port: rinfo.port,
            address: rinfo.address
        }
    }, {
        type: stun.STUN.ATTRS.USERNAME,
        value: this.remote_info.credentials.ufrag + ':' + this.credentials.ufrag
    }, {
        type: stun.STUN.ATTRS.PASSWORD_OLD,
        value: this.remote_info.credentials.pwd
    }], buffer);

    return Q.ninvoke(this.socket, 'send',
            reply, 0, reply.length,
            rinfo.port, rinfo.address)
        .then(null, function(err) {
            dbg.warn('ICE _handle_stun_request SEND RESPONSE FAILED',
                rinfo, err.stack || err);
        });
};


/**
 *
 * _handle_stun_response
 *
 * this is a stun response from a stun server, letting us know
 * what is our reflexive address as it sees us.
 * we keep all the addresses we discover in a map (without dups),
 * so they can be used later for contacting us from other peers.
 *
 */
IceConnection.prototype._handle_stun_response = function(buffer, rinfo) {
    var attr_map = this._check_stun_credentials(buffer);
    if (!attr_map) {
        return;
    }
    var addr = attr_map.address;
    if (addr) {
        dbg.log0('ICE _handle_stun_response ADDRESS', addr);
        this.addresses[addr.address + ':' + addr.port] = addr;

        // select this remote address since we got a valid response from it
        this._select_remote_address(rinfo);
    }
};


/**
 *
 * _check_stun_credentials
 *
 */
IceConnection.prototype._check_stun_credentials = function(buffer, rinfo) {
    var attr_map = stun.get_attrs_map(buffer);
    if (!this.remote_info || !this.remote_info.credentials) {
        dbg.log0('ICE _check_stun_credentials NO REMOTE INFO');
        return;
    }
    if (!attr_map.username) {
        dbg.log0('ICE _check_stun_credentials NO USERNAME', attr_map);
        return;
    }

    // check the credentials match
    var frags = attr_map.username.split(':', 2);
    if (frags[0] !== this.credentials.ufrag ||
        frags[1] !== this.remote_info.credentials.ufrag ||
        attr_map.password !== this.credentials.pwd) {
        dbg.log0('ICE _check_stun_credentials CREDENTIALS MISMATCH',
            attr_map, this.credentials, this.remote_info.credentials);
        return;
    }

    return attr_map;
};


/**
 *
 * _select_remote_address
 *
 */
IceConnection.prototype._select_remote_address = function(rinfo) {
    if (!this.selected_addr) {
        dbg.log0('ICE READY - SELECTED ADDRESS', rinfo.address + ':' + rinfo.port);
        this.selected_addr = rinfo;
        stun.indication_loop(this.socket, rinfo.address, rinfo.port);
    }
    if (this.select_addr_defer) {
        this.select_addr_defer.resolve();
        this.select_addr_defer = null;
    }
};
