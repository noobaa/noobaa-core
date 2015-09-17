'use strict';

module.exports = Ice;

var _ = require('lodash');
var P = require('../util/promise');
var url = require('url');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var ip_module = require('ip');
var stun = require('./stun');
var chance = require('chance')();
var dbg = require('../util/debug_module')(__filename);


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

util.inherits(Ice, EventEmitter);

/**
 *
 * Ice
 *
 * minimalistic implementation of ICE - https://tools.ietf.org/html/rfc5245
 * we chose a small subset of the spec to keep it simple,
 * but this module will continue to develop as we encounter more complicated networks.
 *
 */
function Ice(options) {
    var self = this;
    EventEmitter.call(self);

    self.ip = ip_module.address();
    self.selected_candidate = null;
    self.stun_candidate_defer = P.defer();

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
}

Ice.STUN_SERVERS = [];
Ice.SIMPLE_STUN_REQUEST = stun.new_packet(stun.METHODS.REQUEST);
Ice.SIMPLE_STUN_INDICATION = stun.new_packet(stun.METHODS.INDICATION);

/**
 * static function to add a stun server to be used (picked at random)
 */
Ice.add_stun_server = function(stun_url) {
    if (!(stun_url instanceof url.Url)) {
        stun_url = url.parse(stun_url);
    }
    Ice.STUN_SERVERS.push(stun_url);
};

/**
 * static function to get the stun server to use
 */
Ice.get_stun_server = function() {
    switch (Ice.STUN_SERVERS.length) {
        case 0:
            return;
        case 1:
            return Ice.STUN_SERVERS[0];
        default:
            return chance.pick(Ice.STUN_SERVERS);
    }
};

// TODO take this away from here to the agent heartbeat
read_on_premise_stun_server();

function read_on_premise_stun_server() {
    try {
        var fs = require('fs');
        var agent_conf = JSON.parse(fs.readFileSync('agent_conf.json'));
        var on_premise_server = url.parse(agent_conf.address);
        var stun_url = url.parse('stun://' + on_premise_server.hostname + ':' + stun.PORT);
        Ice.add_stun_server(stun_url);
        dbg.log0('using on-premise ICE/STUN server from agent_conf.json', stun_url);
    } catch (err) {
        dbg.warn('agent_conf.json does not exist/valid, no stun server to use !!!');
    }
}

Ice.prototype.close = function() {
    this.closed = true;
};

Ice.prototype.throw_if_close = function(from) {
    if (this.closed) {
        throw new Error("ICE CLOSED " + (from || ''));
    }
};

/**
 *
 * connect
 *
 */
Ice.prototype.connect = function(local_port) {
    var self = this;
    self.local_port = local_port;
    dbg.log1('ICE connect: local_port', local_port);
    return P.fcall(function() {
            return self._collect_local_candidates();
        })
        .then(function() {

            // send local info using the signaller
            return self.signaller(self.local);
        })
        .then(function(remote_info) {

            // merge the remote info - to set credentials and add new candidates
            _.merge(self.remote, remote_info);

            // punch hole using the remote info returned from the signal call
            return self._connect_remote_candidates();
        });
};


/**
 *
 * accept
 *
 */
Ice.prototype.accept = function(local_port, remote_info) {
    var self = this;
    self.local_port = local_port;
    dbg.log1('ICE accept: local_port', local_port);

    // merge the remote info - to set credentials and add new candidates
    _.merge(self.remote, remote_info);

    return P.fcall(function() {
            return self._collect_local_candidates();
        })
        .then(function() {

            // don't wait for the address selection
            // because we need to return the candidates first
            // to the sender of the signal so that it will send us
            // stun requests.
            self._connect_remote_candidates();

            // return my local info over the signal
            return self.local;
        });
};


/**
 *
 * _collect_local_candidates
 *
 */
Ice.prototype._collect_local_candidates = function() {
    var self = this;
    var stun_url = Ice.get_stun_server();
    var attempts = 0;

    // add my host address
    self._add_local_candidate({
        type: CAND_TYPE_HOST,
        family: 'IPv4',
        address: self.ip,
        port: self.local_port
    });

    if (!stun_url) {
        return;
    }

    // sending stun request to discover my address outside of the NAT
    // and keep the stun mapping open after by sending indications
    // periodically.
    return send_stun_request_and_wait()
        .then(run_indication_loop);

    function send_stun_request_and_wait() {
        self.throw_if_close('_collect_local_candidates (request)');
        if (attempts++ >= 20) {
            throw new Error('ICE _collect_local_candidates: NO RESPONSE FROM STUN SERVER ' +
                stun_url.hostname + ':' + stun_url.port);
        }
        // send the request
        P.fcall(self.sender, Ice.SIMPLE_STUN_REQUEST, stun_url.port, stun_url.hostname);
        // in parallel to the send start waiting for a response
        // if it arrived then we are done, if timedout then send again
        return self.stun_candidate_defer.promise
            .timeout(200)
            .catch(send_stun_request_and_wait);
    }

    function run_indication_loop() {
        self.throw_if_close('_collect_local_candidates (indication)');
        P.fcall(self.sender, Ice.SIMPLE_STUN_INDICATION, stun_url.port, stun_url.hostname);
        return P.delay(stun.INDICATION_INTERVAL * chance.floating(stun.INDICATION_JITTER))
            .then(run_indication_loop);
    }
};

/**
 *
 * _connect_remote_candidate
 *
 */
Ice.prototype._connect_remote_candidate = function(credentials, addr) {
    var self = this;
    var attempts = 0;
    var buffer = stun.new_packet(stun.METHODS.REQUEST, [{
        type: stun.ATTRS.USERNAME,
        value: credentials.ufrag + ':' + self.local.credentials.ufrag
    }, {
        type: stun.ATTRS.PASSWORD_OLD,
        value: credentials.pwd
    }]);

    return send_stun_connect_and_wait();

    function send_stun_connect_and_wait() {
        self.throw_if_close('_connect_remote_candidate');
        // we are done if address was selected
        if (self.selected_candidate) return;
        if (attempts++ >= 50) {
            // dont throw on attempts exhausted,
            // because some other candidate might succeed
            dbg.warn('ICE _connect_remote_candidate: ATTEMPTS EXHAUSTED for address', addr,
                'local_port', self.local_port);
            return;
        }
        P.fcall(self.sender, buffer, addr.port, addr.address);
        // TODO implement ICE scheduling https://tools.ietf.org/html/rfc5245#page-37
        return P.delay(200).then(send_stun_connect_and_wait);
    }
};


/**
 *
 * _connect_remote_candidates
 *
 */
Ice.prototype._connect_remote_candidates = function() {
    var self = this;
    return P.fcall(function() {
            dbg.log0('ICE _connect_remote_candidates: remote info', self.remote,
                'local_port', self.local_port);
            // send stun request to each of the remote candidates
            return P.all(_.map(self.remote.candidates, function(candidate) {
                return self._connect_remote_candidate(self.remote.credentials, candidate);
            }));
        })
        .then(function() {
            if (self.selected_candidate) {
                return self.selected_candidate;
            }
            throw new Error('ICE _connect_remote_candidates: CONNECT TIMEOUT');
        });
};


/**
 *
 * handle_stun_packet
 *
 */
Ice.prototype.handle_stun_packet = function(buffer, rinfo) {
    var method = stun.get_method_field(buffer);
    switch (method) {
        case stun.METHODS.INDICATION:
            // indication = keepalives
            dbg.log3('ICE handle_stun_packet: stun indication',
                rinfo.address + ':' + rinfo.port, 'local_port', this.local_port);
            break;
        case stun.METHODS.ERROR:
            // most likely a problem in the request we sent.
            dbg.warn('ICE handle_stun_packet: STUN ERROR',
                rinfo.address + ':' + rinfo.port, 'local_port', this.local_port);
            break;
        case stun.METHODS.REQUEST:
            this._handle_stun_request(buffer, rinfo);
            break;
        case stun.METHODS.SUCCESS:
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
Ice.prototype._handle_stun_request = function(buffer, rinfo) {
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
    var reply = stun.new_packet(stun.METHODS.SUCCESS, [{
        type: stun.ATTRS.XOR_MAPPED_ADDRESS,
        value: {
            family: 'IPv4',
            port: rinfo.port,
            address: rinfo.address
        }
    }, {
        type: stun.ATTRS.USERNAME,
        value: this.remote.credentials.ufrag + ':' + this.local.credentials.ufrag
    }, {
        type: stun.ATTRS.PASSWORD_OLD,
        value: this.remote.credentials.pwd
    }], buffer);

    return this.sender(reply, rinfo.port, rinfo.address)
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
Ice.prototype._handle_stun_response = function(buffer, rinfo) {
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
Ice.prototype._check_stun_credentials = function(attr_map) {
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
Ice.prototype._add_local_candidate = function(candidate) {
    var addr = candidate.address + ':' + candidate.port;

    dbg.log1('ICE LOCAL CANDIDATE', addr,
        'type', candidate.type,
        'local_port', this.local_port);

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
Ice.prototype._add_remote_candidate = function(candidate) {
    var addr = candidate.address + ':' + candidate.port;

    dbg.log1('ICE REMOTE CANDIDATE', addr,
        'type', candidate.type,
        'local_port', this.local_port);

    this.remote.candidates[addr] = candidate;

    if (!this.selected_candidate) {
        dbg.log0('ICE READY ~~~ SELECTED CANDIDATE', addr, 'local_port', this.local_port);
        this._select_remote_candidate(candidate);
    } else if (ip_module.isPrivate(candidate.address) &&
        !ip_module.isPrivate(this.selected_candidate.address)) {
        dbg.log0('ICE READY ~~~ RE-SELECTED CANDIDATE', addr, 'local_port', this.local_port);
        this._select_remote_candidate(candidate);
    }
};

/**
 *
 * _select_remote_candidate
 *
 */
Ice.prototype._select_remote_candidate = function(candidate) {
    this.selected_candidate = candidate;
    this._selected_candidate_keepalive();
};

Ice.prototype._selected_candidate_keepalive = function() {
    var self = this;
    if (self._selected_candidate_keepalive_running) return;
    self._selected_candidate_keepalive_running = true;
    send_keepalive_and_delay();

    function send_keepalive_and_delay() {
        self.throw_if_close('_selected_candidate_keepalive');
        var buffer = stun.new_packet(stun.METHODS.REQUEST, [{
            type: stun.ATTRS.USERNAME,
            value: self.remote.credentials.ufrag + ':' + self.local.credentials.ufrag
        }, {
            type: stun.ATTRS.PASSWORD_OLD,
            value: self.remote.credentials.pwd
        }]);
        P.fcall(self.sender, buffer, self.selected_candidate.port, self.selected_candidate.address);
        return P.delay(stun.INDICATION_INTERVAL * chance.floating(stun.INDICATION_JITTER))
            .then(send_keepalive_and_delay);
    }
};
