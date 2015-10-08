'use strict';

module.exports = Ice;

var _ = require('lodash');
var P = require('../util/promise');
var os = require('os');
var net = require('net');
var tls = require('tls');
var url = require('url');
var path = require('path');
var util = require('util');
var ip_module = require('ip');
var crypto = require('crypto');
var EventEmitter = require('events').EventEmitter;
var stun = require('./stun');
var chance = require('chance')();
var js_utils = require('../util/js_utils');
var url_utils = require('../util/url_utils');
var FrameStream = require('../util/frame_stream');
var dbg = require('../util/debug_module')(__filename);


const CAND_TYPE_HOST = 'host';
const CAND_TYPE_SERVER_REFLEX = 'server';
const CAND_TYPE_PEER_REFLEX = 'peer';
const CAND_DISCARD_PORT = 9;
const CAND_TCP_TYPE_ACTIVE = 'active';
const CAND_TCP_TYPE_PASSIVE = 'passive';
const CAND_TCP_TYPE_SO = 'so';

const ICE_UFRAG_LENGTH = 4;
const ICE_PWD_LENGTH = 22;
const RAND_ICE_CHAR_POOL_64 =
    'abcdefghijklmnopqrstuvwxyz' +
    'ABCDEFGHIJKLMNOPQRTTUVWXYZ' +
    '0123456789+/';

const ICE_FRAME_CONFIG = {
    magic: 'ICEmagic'
};
const ICE_FRAME_STUN_MSG_TYPE = 1;

util.inherits(Ice, EventEmitter);

/**
 *
 * Ice
 *
 * minimalistic implementation of Interactive Connectivity Establishment (ICE) -
 * https://tools.ietf.org/html/rfc5245 (ICE UDP)
 * https://tools.ietf.org/html/rfc6544 (ICE TCP)
 * we chose a small subset of the spec to keep it simple,
 * but this module will continue to develop as we encounter more complicated networks.
 *
 * @param config - ICE configuration object with the following properties:
 *
 *  stun_servers: (array of urls)
 *      used to get server reflexive addresses for NAT traversal.
 *
 *  udp_socket: (function())
 *      used to create a udp socket and bind it to a port (random typically).
 *      the returned object can send packets using send(buffer,port,host),
 *      and once messages are received it should detect stun messages (see in stun.js)
 *      and call emit 'stun' events on received stun packet to be handled by ICE.
 *
 *  tcp_secure: (boolean)
 *      when true will upgrade to TLS after ICE connects
 *  tcp_active: (boolean)
 *      this endpoint will offer to connect using tcp.
 *  tcp_random_passive: (boolean)
 *      this endpoint will listen on a random port.
 *  tcp_fixed_passive: (port number)
 *      this endpoint will listen on the given port
 *      (will keep the server shared with other ice connections).
 *  tcp_so: (boolean)
 *      simultaneous_open means both endpoints will connect simultaneously,
 *      see https://en.wikipedia.org/wiki/TCP_hole_punching
 *
 *  signaller: (function(info))
 *      send signal over relayed channel to the peer to communicate
 *      the credentials and candidates.
 *      this should be SDP format by the spec, but it's simpler to use
 *      plain JSON for now.
 *
 *  ufrag_length: (integer) (optional)
 *      change the default ice credential length
 *  pwd_length: (integer) (optional)
 *      change the default ice credential length
 *
 */
function Ice(connid, config) {
    var self = this;
    EventEmitter.call(self);

    // connid is provided externally for debugging
    self.connid = connid;

    // config object for ICE (see detailed list in the doc above)
    self.config = config;

    // sessions map, the keys are generated stun tid's
    // which will allow to match the replies to the requests
    self.sessions = {};

    self.networks = _.flatten(_.map(os.networkInterfaces(), function(addresses, name) {
        _.each(addresses, function(addr) {
            addr.ifcname = name;
        });
        return addresses;
    }));

    self.selected_candidate = null;

    self.local = {
        credentials: {
            ufrag: random_crypto_string(
                self.config.ufrag_length || ICE_UFRAG_LENGTH,
                RAND_ICE_CHAR_POOL_64),
            pwd: random_crypto_string(
                self.config.pwd_length || ICE_PWD_LENGTH,
                RAND_ICE_CHAR_POOL_64),
        },
        candidates: {}
    };

    self.remote = {
        credentials: {},
        candidates: {}
    };
}

/**
 * using crypto random to avoid predictability
 */
function random_crypto_string(len, char_pool) {
    var str = '';
    var bytes = crypto.randomBytes(len);
    for (var i = 0; i < len; ++i) {
        str += char_pool[bytes[i] % char_pool.length];
    }
    return str;
}


/**
 *
 * connect
 *
 */
Ice.prototype.connect = function() {
    var self = this;

    return P.fcall(function() {

            // open sockets to create local candidates
            dbg.log0('ICE CONNECT INIT', self.connid);
            return self._init_local_candidates();
        })
        .then(function(local_info) {

            // send local info using the signaller
            dbg.log0('ICE CONNECT LOCAL INFO', local_info, self.connid);
            return self.config.signaller(local_info);
        })
        .then(function(remote_info) {

            // connectivity attempys using the remote info returned from the signal call
            dbg.log0('ICE CONNECT REMOTE INFO', remote_info, self.connid);
            return self._connect_remote_candidates(remote_info);
        })
        .fail(function(err) {
            self.close(err);
            throw err;
        });
};


/**
 *
 * accept
 *
 */
Ice.prototype.accept = function(remote_info) {
    var self = this;

    return P.fcall(function() {

            // open sockets to create local candidates
            dbg.log0('ICE ACCEPT INIT', self.connid);
            return self._init_local_candidates();
        })
        .then(function(local_info) {


            // we schedule the connectivity checks in the background
            // since we need to return our local candidates first
            // for the peer to be able to simultaneously run the checks.
            setTimeout(function() {
                dbg.log0('ICE ACCEPT REMOTE INFO', remote_info, self.connid);
                self._connect_remote_candidates(remote_info);
            }, 10);

            // return my local info over the signal
            dbg.log0('ICE ACCEPT LOCAL INFO', local_info, self.connid);
            return local_info;
        })
        .fail(function(err) {
            self.close(err);
            throw err;
        });
};


/**
 * _init_local_candidates
 */
Ice.prototype._init_local_candidates = function() {
    var self = this;
    return P.join(
            self._init_udp_candidates(),
            self._init_tcp_active_candidates(),
            self._init_tcp_random_passive_candidates(),
            self._init_tcp_fixed_passive_candidates(),
            self._init_tcp_so_candidates()
        )
        .then(function() {
            return {
                credentials: self.local.credentials,
                candidates: _.mapValues(self.local.candidates, function(cand) {
                    return _.pick(cand,
                        'type',
                        'transport',
                        'tcp_type',
                        'ifcname',
                        'internal',
                        'family',
                        'address',
                        'port');
                })
            };
        });
};

/**
 * _init_udp_candidates
 */
Ice.prototype._init_udp_candidates = function() {
    var self = this;

    if (!self.config.udp_socket) return;

    return P.fcall(self.config.udp_socket)
        .then(function(udp) {
            self.udp = udp;
            self._init_udp_connection(udp);

            // we bind the udp socket to all interfaces, so add candidate to each
            _.each(self.networks, function(n, ifcname) {
                self._add_local_candidate({
                    type: CAND_TYPE_HOST,
                    transport: 'udp',
                    ifcname: n.ifcname,
                    internal: n.internal, // aka loopback
                    family: n.family,
                    address: n.address,
                    port: self.udp.port,
                    udp: udp
                });
            });

            return self._request_stun_servers_candidates(udp);
        });
};


/**
 * _init_tcp_active_candidates
 */
Ice.prototype._init_tcp_active_candidates = function() {
    var self = this;
    if (!self.config.tcp_active) return;
    _.each(self.networks, function(n, ifcname) {
        self._add_local_candidate({
            type: CAND_TYPE_HOST,
            transport: 'tcp',
            tcp_type: CAND_TCP_TYPE_ACTIVE,
            ifcname: n.ifcname,
            internal: n.internal, // aka loopback
            family: n.family,
            address: n.address,
            port: CAND_DISCARD_PORT,
        });
    });
};

/**
 * _init_tcp_random_passive_candidates
 */
Ice.prototype._init_tcp_random_passive_candidates = function() {
    var self = this;
    if (!self.config.tcp_random_passive) return;

    var server = net.createServer(function(conn) {
        self._init_tcp_connection(conn);
    });

    server.on('error', function(err) {
        // TODO listening failed
        dbg.error('ICE TCP SERVER ERROR', err);
    });

    self.tcp_server = server;

    return P.ninvoke(server, 'listen')
        .then(function() {
            var address = server.address();
            _.each(self.networks, function(n, ifcname) {
                self._add_local_candidate({
                    type: CAND_TYPE_HOST,
                    transport: 'tcp',
                    tcp_type: CAND_TCP_TYPE_PASSIVE,
                    ifcname: n.ifcname,
                    internal: n.internal, // aka loopback
                    family: n.family,
                    address: n.address,
                    port: address.port,
                    tcp_server: server
                });
            });
        });
};

/**
 * _init_tcp_fixed_passive_candidates
 */
Ice.prototype._init_tcp_fixed_passive_candidates = function() {
    var self = this;
    if (!self.config.tcp_fixed_passive) return;

    // TODO implement tcp_fixed_passive
};

/**
 * _init_tcp_so_candidates
 */
Ice.prototype._init_tcp_so_candidates = function() {
    var self = this;
    if (!self.config.tcp_so) return;
    // we create a temp tcp server and listen just to allocate
    // a random port, and then immediately close it
    var server = net.createServer();
    return P.ninvoke(server, 'listen')
        .then(function() {
            var address = server.address();
            server.close();
            _.each(self.networks, function(n, ifcname) {
                self._add_local_candidate({
                    type: CAND_TYPE_HOST,
                    transport: 'tcp',
                    tcp_type: CAND_TCP_TYPE_SO,
                    ifcname: n.ifcname,
                    internal: n.internal, // aka loopback
                    family: n.family,
                    address: n.address,
                    port: address.port,
                });
            });
        });
};


/**
 * _init_udp_connection
 */
Ice.prototype._init_udp_connection = function(conn) {
    var self = this;

    conn.on('close', function(err) {
        dbg.error('ICE UDP CONN CLOSED', err || '');
    });

    conn.on('error', function(err) {
        dbg.error('ICE UDP CONN ERROR', err || '');
    });

    // TODO limit udp that receives only non-stun messages
    conn.on('stun', function(buffer, info) {
        info.udp = conn;
        self._handle_stun_packet(buffer, info);
    });
};


/**
 * _init_tcp_connection
 */
Ice.prototype._init_tcp_connection = function(conn) {
    var self = this;
    var info = conn.address();
    info.tcp = conn;

    conn.on('close', function(err) {
        dbg.error('ICE TCP CONN CLOSED', err || '');
    });

    // TODO remove ice tcp conn candidates on error
    conn.on('error', function(err) {
        dbg.error('ICE TCP CONN ERROR', err || '');
        conn.destroy();
    });

    // TODO set timeout on idle connection
    conn.on('timeout', function(err) {
        dbg.error('ICE TCP CONN TIMEOUT', err || '');
    });

    // TODO limit tcp that receives only non-stun messages
    conn.frame_stream = new FrameStream(conn, function(buffer, msg_type) {
        if (msg_type === ICE_FRAME_STUN_MSG_TYPE) {
            self._handle_stun_packet(buffer, info);
        } else {
            // TODO handle data messages
        }
    }, ICE_FRAME_CONFIG);
};


/**
 * _new_session
 */
Ice.prototype._new_session = function(is_stun_server) {
    var self = this;
    var packet;
    var tid;
    var attrs;
    if (!is_stun_server) {
        attrs = [{
            type: stun.ATTRS.USERNAME,
            value: self.remote.credentials.ufrag + ':' + self.local.credentials.ufrag
        }, {
            type: stun.ATTRS.PASSWORD_OLD,
            value: self.remote.credentials.pwd
        }];
    }
    do {
        packet = stun.new_packet(stun.METHODS.REQUEST, attrs);
        tid = stun.get_tid_field(packet).toString('base64');
    } while (self.sessions[tid]);
    var session = new IceSession(this, packet);
    self.sessions[tid] = session;
    if (is_stun_server) {
        session.stun_server = true;
    }
    return session;
};


/**
 * _make_stun_response
 */
Ice.prototype._make_stun_response = function(buffer, info) {
    return stun.new_packet(stun.METHODS.SUCCESS, [{
        type: stun.ATTRS.XOR_MAPPED_ADDRESS,
        value: {
            family: info.family,
            address: info.address,
            port: info.port,
        }
    }, {
        type: stun.ATTRS.USERNAME,
        value: this.remote.credentials.ufrag + ':' + this.local.credentials.ufrag
    }, {
        type: stun.ATTRS.PASSWORD_OLD,
        value: this.remote.credentials.pwd
    }], buffer);
};


/**
 *
 * _handle_stun_packet
 *
 */
Ice.prototype._handle_stun_packet = function(buffer, info) {

    // TODO implement stun message integrity check with HMAC

    var method = stun.get_method_field(buffer);
    switch (method) {
        case stun.METHODS.REQUEST:
            return this._handle_stun_request(buffer, info);
        case stun.METHODS.SUCCESS:
            return this._handle_stun_response(buffer, info);
            // case stun.METHODS.INDICATION:
            // case stun.METHODS.ERROR:
        default:
            return this._handle_bad_stun_packet(buffer, info,
                'PACKET WITH UNEXPECTED METHOD ' + method);
    }
};


/**
 *
 * _handle_bad_stun_packet
 *
 */
Ice.prototype._handle_bad_stun_packet = function(buffer, info, reason) {
    // TODO limit received bad stun messages
    dbg.warn('ICE _handle_bad_stun_packet:', reason, info, this.connid);
    if (info.tcp) {
        info.tcp.destroy();
    } else {
        // udp silently ignore to avoid denial of service
        // TODO maybe better fail and restart a new ICE on random port?
    }
};

/**
 *
 * _handle_stun_request
 *
 */
Ice.prototype._handle_stun_request = function(buffer, info) {

    // checking the request credentials match the remote credentials
    // as were communicated by the signaller.
    // we only reply to requests with credentials in this path,
    // since this is meant to be served on a random port.
    // for general stun server just use the stun.js module.
    var attr_map = stun.get_attrs_map(buffer);
    if (!this._check_stun_credentials(attr_map)) {
        return this._handle_bad_stun_packet(buffer, info, 'REQUEST WITH BAD CREDENTIALS');
    }

    // got an authenticated stun request, that's a good candidate for remote communication
    this._add_remote_candidate({
        type: CAND_TYPE_PEER_REFLEX,
        family: info.family,
        address: info.address,
        port: info.port,
        transport: info.tcp ? 'tcp' : 'udp',
        tcp: info.tcp,
        udp: info.udp
    });

    // send response that may or may not be delivered
    // if it does then the peer can add a candidate as well
    // and also he will know the candidate I have for him from the mapped address attr.
    var reply = this._make_stun_response(buffer, info);

    if (info.tcp) {
        info.tcp.frame_stream.send_message(reply, ICE_FRAME_STUN_MSG_TYPE);
    } else {
        info.udp.send_outbound(reply, info.port, info.address, _.noop);
    }
};


/**
 *
 * _handle_stun_response
 *
 * this is a stun response from a stun server or the peer, letting us know
 * what is our reflexive address as it sees us.
 * we keep all the local candidates we discover in a map (without dups),
 * so we can send it over the signalling channel to the peer.
 *
 */
Ice.prototype._handle_stun_response = function(buffer, info) {

    // lookup the tid in the pending requests
    var tid = stun.get_tid_field(buffer).toString('base64');
    var session = this.sessions[tid];
    if (!session) {
        return this._handle_bad_stun_packet(buffer, info, 'RESPONSE TO MISSING SESSION');
    }
    if (session.closed) {
        return this._handle_bad_stun_packet(buffer, info, 'RESPONSE TO CLOSED SESSION');
    }

    var attr_map = stun.get_attrs_map(buffer);
    var cand_type = CAND_TYPE_SERVER_REFLEX;

    if (!session.stun_server) {
        if (!this._check_stun_credentials(attr_map)) {
            session.defer.reject(new Error('ICE STUN RESPONSE BAD CREDENTIALS'));
            this._handle_bad_stun_packet(buffer, info, 'RESPONSE WITH BAD CREDENTIALS');
            return;
        }
        // this means the response is from the peer and not from public stun server
        cand_type = CAND_TYPE_PEER_REFLEX;
        // add this remote address since we got a valid response from it
        this._add_remote_candidate({
            type: cand_type,
            family: info.family,
            address: info.address,
            port: info.port,
            transport: info.tcp ? 'tcp' : 'udp',
            tcp: info.tcp,
            udp: info.udp
        });
    }

    // add the local address from the stun mapped address field
    // we do it also for peer responses although we currently signal only once
    // and at this stage we already signalled, so this will not be used.
    if (attr_map.address) {
        this._add_local_candidate({
            type: cand_type,
            transport: info.tcp ? 'tcp' : 'udp',
            family: attr_map.address.family,
            address: attr_map.address.address,
            port: attr_map.address.port,
            udp: info.udp,
            tcp: info.tcp
        });
    }

    // resolve the request to let the waiter know its done
    session.defer.resolve(info);
};


/**
 *
 * _request_stun_servers_candidates
 *
 * sending stun requests to public servers to discover my address outside of the NAT
 * and keep the stun mapping open after by sending indications periodically.
 *
 */
Ice.prototype._request_stun_servers_candidates = function(udp) {
    var self = this;

    return P.all(_.map(self.config.stun_servers, function(stun_url) {
        // this request is to public server and we need to know that
        // when processing the response to not require it to include credentials,
        // while the peer stun messages will be required to include it.
        var session = self._new_session('stun server');
        session.transport = 'udp';
        session.udp = udp;
        stun_url = _.isString(stun_url) ? url_utils.quick_parse(stun_url) : stun_url;
        session.udp_host = stun_url.hostname;
        session.udp_port = stun_url.port;
        // indication packet copy tid from request packet, not sure if needed,
        // but seems like it would make sense to the stun server
        // to see the indications coming from the same tid session.
        session.indication = stun.new_packet(stun.METHODS.INDICATION, null, session.packet);
        // start sending udp requests
        session.send_udp_request_loop();
        return session.defer.promise
            // once replied, start sending indications until the request is closed
            .then(function() {
                session.send_udp_indication_loop();
            })
            // wait for the reply for 5 seconds before timeout
            .timeout(5000)
            // on timeout mark this request as closed
            .catch(function(err) {
                session.error = err;
                session.closed = true;
                session.defer.reject(err);
            });
    }));
};


/**
 *
 * _connect_remote_candidates
 *
 */
Ice.prototype._connect_remote_candidates = function(remote_info) {
    var self = this;

    // merge the remote info - to set credentials and candidates
    _.merge(self.remote, remote_info);

    // create a list of pairs of candidates to be tested
    // TODO should we support foundation and frozen candidates?
    self.candidate_pairs = {};

    return P.map(self.local.candidates, function(l) {
            // ignore loopback candidates for now
            if (l.internal) return;
            // ignore apple internal network
            if (l.ifcname && l.ifcname.startsWith('awdl')) return;
            // match against each remote candidate
            return P.map(self.remote.candidates, function(r) {
                if (r.internal) return;
                if (r.ifcname && l.ifcname.startsWith('awdl')) return;
                if (l.family !== r.family) return;
                if (l.transport !== r.transport) return;
                if (l.tcp_type === CAND_TCP_TYPE_PASSIVE) return;
                if (l.tcp_type === CAND_TCP_TYPE_ACTIVE &&
                    r.tcp_type !== CAND_TCP_TYPE_PASSIVE) return;
                if (l.tcp_type === CAND_TCP_TYPE_SO &&
                    r.tcp_type !== CAND_TCP_TYPE_SO) return;
                dbg.log0('ICE _connect_remote_candidates: candidate pair',
                    'LOCAL', l, 'REMOTE', r);
                var pair_key = l.key + '<->' + r.key;
                var pair = {
                    local: l,
                    remote: r
                };
                self.candidate_pairs[pair_key] = pair;
                return self._connect_candidate_pair(pair);
            });
        })
        .then(function() {
            if (!self.selected_candidate) {
                throw new Error('ICE _connect_remote_candidates: CONNECT TIMEOUT');
            }
        })
        .fail(function(err) {
            self.close(err);
            throw err;
        });
};


/**
 *
 * _connect_candidate_pair
 *
 */
Ice.prototype._connect_candidate_pair = function(pair) {
    var self = this;

    var session = self._new_session();
    if (pair.local.transport === 'tcp') {
        session.transport = 'tcp';
        if (pair.local.tcp_type === CAND_TCP_TYPE_SO) {
            self._connect_tcp_so_pair(session, pair);
        } else {
            self._connect_tcp_active_passive_pair(session, pair);
        }
    } else {
        session.transport = 'udp';
        session.udp = pair.local.udp;
        session.udp_host = pair.remote.address;
        session.udp_port = pair.remote.port;
        session.send_udp_request_loop();
    }

    return session.defer.promise
        // wait for the reply for 5 seconds before timeout
        .timeout(5000)
        // on timeout mark this request as closed
        .then(function(info) {
            dbg.warn('ICE PAIR SUCCESSFUL', pair, info);
        })
        .catch(function(err) {
            session.error = err;
            session.closed = true;
            session.defer.reject(err);
            dbg.warn('ICE PAIR NO SUCCESS', pair, err);
        });
};


/**
 *
 * _connect_tcp_so_pair
 *
 */
Ice.prototype._connect_tcp_so_pair = function(session, pair) {
    var self = this;
    var so_max_delay_ms = 100;
    var try_so = function() {
        session.tcp = net.connect(pair.remote.port, pair.remote.address);
        session.tcp.on('error', function(err) {
            session.tcp.destroy();
            if (so_max_delay_ms <= 0 || self.closed) {
                session.defer.reject(new Error('ICE TCP SO EXHAUSTED'));
            } else {
                setTimeout(try_so, so_max_delay_ms * Math.random());
                so_max_delay_ms -= 0.1;
            }
        });
        session.tcp.on('connect', function(err) {
            so_max_delay_ms = 0;
            self._init_tcp_connection(session.tcp);
            session.send_tcp_request();
        });
    };
    try_so();
};

/**
 *
 * _connect_tcp_active_passive_pair
 *
 */
Ice.prototype._connect_tcp_active_passive_pair = function(session, pair) {
    var self = this;
    session.tcp = net.connect(pair.remote.port, pair.remote.address);
    session.tcp.on('error', function(err) {
        session.tcp.destroy();
        session.defer.reject(err);
    });
    session.tcp.on('connect', function(err) {
        self._init_tcp_connection(session.tcp);
        session.send_tcp_request();
    });
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
    var cand = new IceCandidate(candidate);
    dbg.log1('ICE LOCAL CANDIDATE', cand.key, this.connid);
    this.local.candidates[cand.key] = cand;
};

/**
 *
 * _add_remote_candidate
 *
 */
Ice.prototype._add_remote_candidate = function(candidate) {
    var cand = new IceCandidate(candidate);
    dbg.log1('ICE REMOTE CANDIDATE', cand.key, this.connid);
    this.remote.candidates[cand.key] = cand;

    if (!this.selected_candidate) {
        dbg.log0('ICE READY ~~~ SELECTED CANDIDATE', cand.key, this.connid);
        this._select_remote_candidate(candidate);
    } else if (ip_module.isPrivate(candidate.address) &&
        !ip_module.isPrivate(this.selected_candidate.address)) {
        dbg.log0('ICE READY ~~~ RE-SELECTED CANDIDATE', cand.key, this.connid);
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
    // this.emit('connect');
    this._selected_candidate_keepalive();
};

Ice.prototype._selected_candidate_keepalive = function() {
    var self = this;
    if (self._selected_candidate_keepalive_running) return;
    self._selected_candidate_keepalive_running = true;
    send_keepalive_and_delay().fail(_.noop);

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

Ice.prototype.close = function() {
    var self = this;
    self.closed = true;
    _.each(self.local.candidates, function(cand) {
        if (cand.tcp_server) {
            cand.tcp_server.close();
        }
        if (cand.udp) {
            cand.udp.close();
        }
    });
    _.each(self.sessions, function(session) {
        session.closed = true;
        session.defer.reject(new Error('ICE CLOSED'));
        if (session.udp) {
            session.udp.close();
        }
        if (session.tcp) {
            session.tcp.destroy();
        }
    });
};

Ice.prototype.throw_if_close = function(from) {
    if (this.closed) {
        throw new Error('ICE CLOSED ' + this.connid + ' ' + (from || ''));
    }
};


function IceCandidate(cand) {
    cand.key = url.format({
        protocol: cand.transport + (cand.family === 'IPv6' ? 6 : 4),
        hostname: cand.address,
        port: cand.port,
        path: path.join(cand.type, cand.tcp_type || '')
    });
    return cand;
}

function IceSession(ice, packet) {
    this.ice = ice;
    this.packet = packet;
    this.defer = P.defer();
    js_utils.self_bind(this, 'send_udp_request_loop');
    js_utils.self_bind(this, 'send_udp_indication_loop');
}

IceSession.prototype.send_tcp_request = function() {
    this.tcp.frame_stream.send_message(this.packet, ICE_FRAME_STUN_MSG_TYPE);
};

IceSession.prototype.send_udp_request_loop = function() {
    if (this.ice.closed) return;
    if (this.closed) return;
    this.udp.send_outbound(this.packet, this.udp_port, this.udp_host);
    return P.delay(100).then(this.send_udp_request_loop);
};

IceSession.prototype.send_udp_indication_loop = function() {
    if (this.ice.closed) return;
    if (this.closed) return;
    this.udp.send_outbound(this.indication, this.udp_port, this.udp_host);
    return P.delay(stun.INDICATION_INTERVAL * chance.floating(stun.INDICATION_JITTER))
        .then(this.send_udp_indication_loop);
};
