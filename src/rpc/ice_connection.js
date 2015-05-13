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

var CAND_TYPE_HOST = 'host';
var CAND_TYPE_SERVER_REFLEX = 'server';
var CAND_TYPE_PEER_REFLEX = 'peer';

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

    self.signaller = options.signaller;
    self.addr_url = options.addr_url;

    var socket = dgram.createSocket('udp4');
    self.socket = socket;
    self.ip = ip_module.address();
    self.port = 0;

    self.local = {
        credentials: {
            ufrag: chance.string(RAND_ICE_UFRAG),
            pwd: chance.string(RAND_ICE_PWD),
        },
        candidates: {}
    };
    self.remote = {
        credentials: {},
        candidates: {}
    };

    self.selected_candidate = null;
    self.stun_candidate_defer = Q.defer();

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
        dbg.error('ICE SOCKET CLOSED my port', self.port);
        self.close();
    });

    // this might occur on ESRCH error from getaddrinfo() for dns resolve.
    socket.on('error', function(err) {
        dbg.error('ICE SOCKET ERROR my port', self.port, err.stack || err);
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
    if (this.selected_candidate) {
        return;
    }
    if (self.connect_promise) {
        return self.connect_promise;
    }

    self.connect_promise = self._bind()
        .then(function() {

            // send local info using the signaller
            return self.signaller(self.local);
        })
        .then(function(remote_info) {

            // merge the remote info - to set credentials and add new candidates
            _.merge(self.remote, remote_info);

            // punch hole using the remote info returned from the signal call
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
IceConnection.prototype.accept = function(remote_info) {
    var self = this;

    // merge the remote info - to set credentials and add new candidates
    _.merge(self.remote, remote_info);

    if (this.selected_candidate) {
        return;
    }
    if (self.accept_promise) {
        return self.accept_promise;
    }

    self.accept_promise = self._bind()
        .then(function() {

            // don't wait for the address selection
            // because we need to return the candidates first
            // to the sender of the signal so that it will send us
            // stun requests.
            self._punch_holes();

            // return my local info over the signal
            return self.local;
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
    if (!this.selected_candidate) {
        dbg.log0('ICE send: SOCKET NOT READY port', this.port);
        return;
    }
    this.socket.send(
        buffer,
        offset || 0,
        length || buffer.length,
        this.selected_candidate.port,
        this.selected_candidate.address,
        this.error_handler);
};


/**
 *
 * close
 *
 */
IceConnection.prototype.close = function() {
    this.selected_candidate = null;
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

    // bind the udp socket to requested port (can be 0 to allocate random)
    return Q.ninvoke(self.socket, 'bind', self.port)
        .then(function() {

            // update port in case it was 0 to bind to any port
            self.port = self.socket.address().port;

            return self._gather_local_candidates();
        });
};


/**
 *
 * _gather_local_candidates
 *
 */
IceConnection.prototype._gather_local_candidates = function() {
    var self = this;
    var stun_url = stun.STUN.DEFAULT_SERVER;

    return Q.fcall(function() {

            // add my host address
            self._add_local_candidate({
                type: CAND_TYPE_HOST,
                family: 'IPv4',
                address: self.ip,
                port: self.port
            });

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

            return self.stun_candidate_defer.promise
                .timeout(10000, 'STUN SERVER RESPONSE EXHAUSTED');
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
    if (self.selected_candidate) {
        return;
    }

    // stop fast if socket is closed
    if (self.closed) {
        return;
    }

    // dont throw on attempts exhausted,
    // because some other candidate might succeed
    if (attempts >= 300) {
        dbg.warn('ICE _punch_hole: ATTEMPTS EXHAUSTED for address', addr,
            'my port', self.port);
        return;
    }

    var buffer = stun.new_packet(stun.STUN.METHODS.REQUEST, [{
        type: stun.STUN.ATTRS.USERNAME,
        value: credentials.ufrag + ':' + self.local.credentials.ufrag
    }, {
        type: stun.STUN.ATTRS.PASSWORD_OLD,
        value: credentials.pwd
    }]);

    return Q.ninvoke(self.socket, 'send',
            buffer, 0, buffer.length,
            addr.port, addr.address)
        .then(null, function(err) {

            // on send error it probably means that the socket is faulty
            // so propagate the error to the caller to close.
            dbg.warn('ICE _punch_hole: SEND STUN FAILED to address', addr,
                'my port', self.port, err.stack || err);
            throw err;

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
            dbg.log0('ICE _punch_holes: remote info', self.remote,
                'my port', self.port);
            // send stun request to each of the remote candidates
            return Q.all(_.map(self.remote.candidates,
                self._punch_hole.bind(self, self.remote.credentials)));
        })
        .then(function() {
            if (!self.selected_candidate) {
                throw new Error('ICE _punch_holes: EXHAUSTED');
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
            dbg.log3('ICE _handle_stun_packet: stun indication',
                rinfo.address + ':' + rinfo.port, 'my port', this.port);
            break;
        case stun.STUN.METHODS.ERROR:
            // most likely a problem in the request we sent.
            dbg.warn('ICE _handle_stun_packet: STUN ERROR',
                rinfo.address + ':' + rinfo.port, 'my port', this.port);
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
    var attr_map = stun.get_attrs_map(buffer);
    if (!this._check_stun_credentials(attr_map)) {
        return;
    }

    this._add_remote_candidate({
        type: CAND_TYPE_PEER_REFLEX,
        family: 'IPv4',
        address: rinfo.address,
        port: rinfo.port
    });

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
        value: this.remote.credentials.ufrag + ':' + this.local.credentials.ufrag
    }, {
        type: stun.STUN.ATTRS.PASSWORD_OLD,
        value: this.remote.credentials.pwd
    }], buffer);

    return Q.ninvoke(this.socket, 'send',
            reply, 0, reply.length,
            rinfo.port, rinfo.address)
        .then(null, function(err) {
            dbg.warn('ICE _handle_stun_request: SEND RESPONSE FAILED',
                rinfo, err.stack || err);
        });
};


/**
 *
 * _handle_stun_response
 *
 * this is a stun response from a stun server, letting us know
 * what is our reflexive address as it sees us.
 * we keep all the local candidates we discover in a map (without dups),
 * so they can be used later for contacting us from other peers.
 *
 */
IceConnection.prototype._handle_stun_response = function(buffer, rinfo) {
    var attr_map = stun.get_attrs_map(buffer);
    var cand_type;

    if (this._check_stun_credentials(attr_map)) {
        // select this remote address since we got a valid response from it
        cand_type = CAND_TYPE_PEER_REFLEX;
        this._add_remote_candidate({
            type: cand_type,
            family: 'IPv4',
            address: rinfo.address,
            port: rinfo.port
        });
    } else {
        cand_type = CAND_TYPE_SERVER_REFLEX;
    }

    if (attr_map.address) {
        this._add_local_candidate({
            type: cand_type,
            family: 'IPv4',
            address: attr_map.address.address,
            port: attr_map.address.port
        });
    }
};


/**
 *
 * _check_stun_credentials
 *
 */
IceConnection.prototype._check_stun_credentials = function(attr_map) {
    if (!attr_map.username) {
        return false;
    }

    // check the credentials match
    var frags = attr_map.username.split(':', 2);
    if (frags[0] !== this.local.credentials.ufrag ||
        frags[1] !== this.remote.credentials.ufrag ||
        attr_map.password !== this.local.credentials.pwd) {
        return false;
    }

    return true;
};


/**
 *
 * _add_local_candidate
 *
 */
IceConnection.prototype._add_local_candidate = function(candidate) {
    var addr = candidate.address + ':' + candidate.port;

    dbg.log0('ICE LOCAL CANDIDATE', addr,
        'type', candidate.type,
        'my port', this.port);

    this.local.candidates[addr] = candidate;

    // continue if we are waiting for the stun server response
    if (candidate.type === CAND_TYPE_SERVER_REFLEX &&
        this.stun_candidate_defer) {
        this.stun_candidate_defer.resolve();
    }
};

/**
 *
 * _add_remote_candidate
 *
 */
IceConnection.prototype._add_remote_candidate = function(candidate) {
    var addr = candidate.address + ':' + candidate.port;

    dbg.log0('ICE REMOTE CANDIDATE', addr,
        'type', candidate.type,
        'my port', this.port);

    this.remote.candidates[addr] = candidate;

    if (!this.selected_candidate) {
        dbg.log0('ICE READY ~~~ SELECTED CANDIDATE', addr, 'my port', this.port);
        this._select_remote_candidate(candidate);
    } else if (ip_module.isPrivate(candidate.address) &&
        !ip_module.isPrivate(this.selected_candidate.address)) {
        dbg.log0('ICE READY ~~~ RE-SELECTED CANDIDATE', addr, 'my port', this.port);
        this._select_remote_candidate(candidate);
    }
};

/**
 *
 * _select_remote_candidate
 *
 */
IceConnection.prototype._select_remote_candidate = function(candidate) {
    this.selected_candidate = candidate;

    // stop previous indication loop if reselecting a candidate
    if (this.selected_candidate_loop) {
        this.selected_candidate_loop.stop = true;
    }

    // start indication loop for candidate
    this.selected_candidate_loop = stun.indication_loop(
        this.socket, candidate.address, candidate.port);
};
