'use strict';

module.exports = Ice;

var _ = require('lodash');
var P = require('../util/promise');
var os = require('os');
var net = require('net');
// var tls = require('tls');
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
 *  ufrag_length: (integer) (optional)
 *      change the default ice credential length
 *  pwd_length: (integer) (optional)
 *      change the default ice credential length
 *
 *  offer_ipv4: (boolean)
 *  offer_ipv6: (boolean)
 *  accept_ipv4: (boolean)
 *  accept_ipv6: (boolean)
 *      the default is true for all. set to false to override.
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
 *  udp_socket: (function())
 *      used to create a udp socket and bind it to a port (random typically).
 *      the returned object can send packets using send(buffer,port,host),
 *      and once messages are received it should detect stun messages (see in stun.js)
 *      and call emit 'stun' events on received stun packet to be handled by ICE.
 *
 *  stun_servers: (array of urls)
 *      used to get server reflexive addresses for NAT traversal.
 *
 *  signaller: (function(target, info))
 *      send signal over relayed channel to the peer to communicate
 *      the credentials and candidates.
 *      this should be SDP format by the spec, but it's simpler to use
 *      plain JSON for now.
 *
 */
function Ice(connid, config, signal_target) {
    var self = this;
    EventEmitter.call(self);

    // connid is provided externally for debugging
    self.connid = connid;

    // config object for ICE (see detailed list in the doc above)
    self.config = config;

    // to be passed as the target when calling the signaller
    self.signal_target = signal_target;

    // sessions map, the keys are generated stun tid's
    // which will allow to match the replies to the requests
    self.sessions = {};

    self.networks = [];
    _.each(os.networkInterfaces(), function(interfaces, name) {
        _.each(interfaces, function(n) {
            // ignore apple internal network
            if (name.startsWith('awdl')) return;
            // ignore loopback candidates for now
            if (self.config.offer_internal === false && n.internal) return;
            if (self.config.offer_ipv4 === false && n.family === 'IPv4') return;
            if (self.config.offer_ipv6 === false && n.family === 'IPv6') return;
            n.ifcname = name;
            self.networks.push(n);
        });
    });

    self.local_credentials = {
        ufrag: random_crypto_string(
            self.config.ufrag_length || ICE_UFRAG_LENGTH,
            RAND_ICE_CHAR_POOL_64),
        pwd: random_crypto_string(
            self.config.pwd_length || ICE_PWD_LENGTH,
            RAND_ICE_CHAR_POOL_64),
    };
    self.local_candidates = {};
    self.remote_credentials = {};
    self.remote_candidates = {};

    self.on('error', function(err) {
        dbg.error('ICE ERROR', err.stack || err);
        self.close();
    });
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

    // mark the connect side as leader, which means I will be the one
    // choosing the best connection to use.
    self.leader = true;

    return P.fcall(function() {

            // open sockets to create local candidates
            dbg.log0('ICE CONNECT INIT', self.connid);
            return self._init_local_candidates();
        })
        .then(function(local_info) {

            // send local info using the signaller
            dbg.log0('ICE CONNECT LOCAL INFO', local_info, self.connid);
            return self.config.signaller(self.signal_target, local_info);
        })
        .then(function(remote_info) {

            // connectivity attempys using the remote info returned from the signal call
            dbg.log0('ICE CONNECT REMOTE INFO', remote_info, self.connid);
            return self._connect_remote_candidates(remote_info);
        })
        .fail(function(err) {
            self.emit('error', err);
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
            self.emit('error', err);
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
                credentials: self.local_credentials,
                candidates: _.mapValues(self.local_candidates, function(cand) {
                    // need to pick properties because we have connections in there
                    // which shouldn't be sent
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
        dbg.log0('ICE TCP ACCEPTED CONNECTION', conn.address());
        self._init_tcp_connection(conn);
    });

    // easy way to remember to close this server when ICE closes
    self.on('close', function() {
        server.close();
    });

    server.on('error', function(err) {
        // TODO listening failed
        dbg.error('ICE TCP SERVER ERROR', err);
    });

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
 *
 * _connect_remote_candidates
 *
 */
Ice.prototype._connect_remote_candidates = function(remote_info) {
    var self = this;

    // set the remote info - to set credentials and candidates
    self.remote_credentials = remote_info.credentials;
    _.each(remote_info.candidates, function(cand) {
        self._add_remote_candidate(cand);
    });

    // TODO should we support foundation and frozen candidates from the SPEC?

    // match each local against each remote candidate
    return P.all(_.map(self.local_candidates, function(l) {
            return P.all(_.map(self.remote_candidates, function(r) {
                if (self.config.accept_ipv4 === false && r.family === 'IPv4') return;
                if (self.config.accept_ipv6 === false && r.family === 'IPv6') return;
                if (l.family !== r.family) return;
                if (l.transport !== r.transport) return;
                if (l.tcp_type === CAND_TCP_TYPE_PASSIVE) return;
                if (l.tcp_type === CAND_TCP_TYPE_ACTIVE &&
                    r.tcp_type !== CAND_TCP_TYPE_PASSIVE) return;
                if (l.tcp_type === CAND_TCP_TYPE_SO &&
                    r.tcp_type !== CAND_TCP_TYPE_SO) return;
                dbg.log0('ICE _connect_remote_candidates:', 'LOCAL', l, 'REMOTE', r);
                return self._connect_candidate_pair(l, r);
            }));
        }))
        .fail(function(err) {
            dbg.error('ICE _connect_remote_candidates: ERROR', err.stack || err);
            self.emit('error', err);
        });
};


/**
 *
 * _connect_candidate_pair
 *
 */
Ice.prototype._connect_candidate_pair = function(local, remote) {
    var self = this;

    var session = self._new_session(local, remote);

    if (local.transport === 'tcp') {
        if (local.tcp_type === CAND_TCP_TYPE_SO) {
            self._connect_tcp_so_pair(session, local, remote);
        } else {
            self._connect_tcp_active_passive_pair(session, local, remote);
        }
    } else {
        session.send_udp_request_loop();
    }

    // wait for the reply for 5 seconds before timeout
    return session.defer.promise
        .timeout(5000)
        .catch(function(err) {
            session.close(err);
        });
};


/**
 *
 * _connect_tcp_active_passive_pair
 *
 */
Ice.prototype._connect_tcp_active_passive_pair = function(session, local, remote) {
    var self = this;
    session.tcp = net.connect(remote.port, remote.address);
    session.tcp.on('error', function(err) {
        dbg.warn('ICE FAILED TCP AP', local.key, '->', remote.key);
        session.tcp.destroy();
        session.close(err);
    });
    session.tcp.on('connect', function(err) {
        dbg.log0('ICE CONNECT TCP AP', local.key, '->', remote.key);
        self._init_tcp_connection(session.tcp, session);
        session.tcp.frame_stream.send_message(session.packet, ICE_FRAME_STUN_MSG_TYPE);
    });
};


/**
 *
 * _connect_tcp_so_pair
 *
 */
Ice.prototype._connect_tcp_so_pair = function(session, local, remote) {
    var self = this;
    var so_max_delay_ms = 100;
    var try_so = function() {
        session.tcp = net.connect(remote.port, remote.address);
        session.tcp.on('error', function(err) {
            session.tcp.destroy();
            if (self.closed || session.closed) {
                dbg.warn('ICE STOPPED TCP SO', local.key, '->', remote.key);
                session.close(new Error('ICE TCP SO CLOSED'));
            } else if (so_max_delay_ms <= 0) {
                dbg.warn('ICE FAILED TCP SO', local.key, '->', remote.key);
                session.close(new Error('ICE TCP SO EXHAUSTED'));
            } else {
                setTimeout(try_so, so_max_delay_ms * Math.random());
                so_max_delay_ms -= 0.1;
            }
        });
        session.tcp.on('connect', function(err) {
            dbg.log0('ICE CONNECT TCP SO', local.key, '->', remote.key);
            so_max_delay_ms = 0;
            self._init_tcp_connection(session.tcp, session);
            // after the connection is made, we prefer just one req-res
            // so we make only the leader send the request.
            if (self.leader) {
                session.tcp.frame_stream.send_message(session.packet, ICE_FRAME_STUN_MSG_TYPE);
            }
        });
    };
    try_so();
};


/**
 * _init_udp_connection
 */
Ice.prototype._init_udp_connection = function(conn) {
    var self = this;

    // easy way to remember to close this connection when ICE closes
    self.on('close', function() {
        conn.close();
    });

    // TODO handld udp socket close
    conn.on('close', function(err) {
        dbg.error('ICE UDP CONN CLOSED', err || '');
    });

    // TODO handld udp socket error
    conn.on('error', function(err) {
        dbg.error('ICE UDP CONN ERROR', err || '');
    });

    // TODO limit udp that receives only non-stun messages
    conn.on('stun', function(buffer, info) {
        info.udp = conn;
        info.href = make_href('udp', info.family, info.address, info.port);
        self._handle_stun_packet(buffer, info);
    });
};


/**
 * _init_tcp_connection
 */
Ice.prototype._init_tcp_connection = function(conn, session) {
    var self = this;
    var info = conn.address();
    info.tcp = conn;
    info.session = session;
    info.href = make_href('tcp', info.family, info.address, info.port);

    // easy way to remember to close this connection when ICE closes
    self.on('close', function() {
        conn.destroy();
    });

    // TODO handld tcp socket close
    conn.on('close', function(err) {
        dbg.error('ICE TCP CONN CLOSED', err || '');
    });

    // TODO remove ice tcp conn candidates on error
    // TODO handld udp socket error
    conn.on('error', function(err) {
        dbg.error('ICE TCP CONN ERROR', err || '');
        conn.destroy();
    });

    // TODO set timeout to detect idle connection
    // TODO handld udp socket timeout
    conn.on('timeout', function(err) {
        dbg.error('ICE TCP CONN TIMEOUT', err || '');
    });

    // TODO limit tcp that receives only non-stun messages
    conn.frame_stream = new FrameStream(conn, function(buffer, msg_type) {
        if (msg_type === ICE_FRAME_STUN_MSG_TYPE) {
            self._handle_stun_packet(buffer, info);
        } else {
            dbg.log0('ICE TCP RECEIVE DATA', buffer.length, info.href);
            conn.emit('message', buffer);
        }
    }, ICE_FRAME_CONFIG);
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
            return this._bad_stun_packet(buffer, info,
                'PACKET WITH UNEXPECTED METHOD ' + method);
    }
};


/**
 *
 * _bad_stun_packet
 *
 */
Ice.prototype._bad_stun_packet = function(buffer, info, reason) {
    // TODO limit overall received bad stun messages
    if (info.tcp) {
        dbg.warn('ICE _bad_stun_packet:', reason, info.href, this.connid);
        info.tcp.destroy();
    } else {
        // udp silently ignore to avoid denial of service
        // TODO maybe better fail and restart a new ICE on random port?
        info.udp.num_bad_stun = 1 + (info.udp.num_bad_stun || 0);
        if (info.udp.num_bad_stun > 100) {
            dbg.warn('ICE _bad_stun_packet: too many udp errors', reason, info.href, this.connid);
            info.udp.close();
        }
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
        return this._bad_stun_packet(buffer, info, 'REQUEST WITH BAD CREDENTIALS');
    }

    dbg.log0('ICE STUN REQUEST', info.href);

    if (!attr_map.address) {
        return this._bad_stun_packet(buffer, info, 'REQUEST WITHOUT ADDRESS');
    }

    if (!info.session) {
        var local = this._add_local_candidate({
            type: CAND_TYPE_PEER_REFLEX,
            transport: info.tcp ? 'tcp' : 'udp',
            family: attr_map.address.family,
            address: attr_map.address.address,
            port: attr_map.address.port,
            udp: info.udp,
            tcp: info.tcp
        });
        var remote = this._add_remote_candidate({
            type: CAND_TYPE_PEER_REFLEX,
            transport: info.tcp ? 'tcp' : 'udp',
            family: info.family,
            address: info.address,
            port: info.port,
            tcp: info.tcp,
            udp: info.udp
        });
        info.session = this._new_session(local, remote, buffer);
    }
    info.session.defer.resolve();
    this._update_sessions();

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
        return this._bad_stun_packet(buffer, info, 'RESPONSE TO MISSING SESSION');
    }
    if (session.closed) {
        return this._bad_stun_packet(buffer, info, 'RESPONSE TO CLOSED SESSION');
    }

    var attr_map = stun.get_attrs_map(buffer);

    // handle response from stun server
    if (session.remote.is_stun_server) {
        dbg.log0('ICE STUN SERVER RESPONSE', info.href);
        // add a local candidate from the stun mapped address field
        if (attr_map.address) {
            this._add_local_candidate({
                type: CAND_TYPE_SERVER_REFLEX,
                transport: info.tcp ? 'tcp' : 'udp',
                family: attr_map.address.family,
                address: attr_map.address.address,
                port: attr_map.address.port,
                udp: info.udp,
                tcp: info.tcp
            });
        }
        session.defer.resolve();
        return;
    }

    dbg.log0('ICE STUN PEER RESPONSE', info.href);

    if (!this._check_stun_credentials(attr_map)) {
        session.close(new Error('ICE STUN RESPONSE BAD CREDENTIALS'));
        return this._bad_stun_packet(buffer, info, 'RESPONSE WITH BAD CREDENTIALS');
    }
    if (!attr_map.address) {
        session.close(new Error('ICE STUN RESPONSE WITHOUT ADDRESS'));
        return this._bad_stun_packet(buffer, info, 'RESPONSE WITHOUT ADDRESS');
    }

    if (!info.session) {
        // add the local address from the stun mapped address field
        // we do it also for peer responses although we currently signal only once
        // and at this stage we already signalled, so this will not be used.
        var local = this._add_local_candidate({
            type: CAND_TYPE_PEER_REFLEX,
            transport: info.tcp ? 'tcp' : 'udp',
            family: attr_map.address.family,
            address: attr_map.address.address,
            port: attr_map.address.port,
            udp: info.udp,
            tcp: info.tcp
        });
        // add this remote address since we got a valid response from it
        var remote = this._add_remote_candidate({
            type: CAND_TYPE_PEER_REFLEX,
            transport: info.tcp ? 'tcp' : 'udp',
            family: info.family,
            address: info.address,
            port: info.port,
            tcp: info.tcp,
            udp: info.udp
        });
        // TODO do we want to add candidates and/or new session?
        info.session = session;
        //this._new_session(local, remote, buffer);
    }

    // resolve the request to let the waiter know its done
    info.session.defer.resolve();
    this._update_sessions();
};


/**
 *
 * _add_local_candidate
 *
 */
Ice.prototype._add_local_candidate = function(candidate) {
    var cand = new IceCandidate(candidate);
    dbg.log1('ICE LOCAL CANDIDATE', cand.key, this.connid);
    this.local_candidates[cand.key] = cand;
};

/**
 *
 * _add_remote_candidate
 *
 */
Ice.prototype._add_remote_candidate = function(candidate) {
    var cand = new IceCandidate(candidate);
    dbg.log1('ICE REMOTE CANDIDATE', cand.key, this.connid);
    this.remote_candidates[cand.key] = cand;
    return cand;
};


/**
 * _new_session
 */
Ice.prototype._new_session = function(local, remote, packet) {
    if (packet && this.sessions[stun.gettid_field(packet)]) {
        throw new Error('DUPLICATE SESSION'); // TODO how to handle
    }
    var session;
    do {
        session = new IceSession(this, local, remote, packet);
    } while (this.sessions[session.tid]);
    this.sessions[session.tid] = session;
    return session;
};


/**
 *
 * _update_sessions
 *
 */
Ice.prototype._update_sessions = function() {
    var self = this;

    // only the leader chooses connection
    if (!self.leader) return;

    if (!self.best_candidate) {
        dbg.log0('ICE BEST CANDIDATE', candidate.key, self.connid);
        self.best_candidate = candidate;
    } else {
        var use_new_candidate = false;
        if (candidate.priority === self.best_candidate.priority) {
            // we pick in arbitrary way that does not require communicating
            // between both peers in order to reach the same conclusion,
            // so here we compare key lexical order
            if (candidate.key > self.best_candidate.key) {
                use_new_candidate = true;
            }
        } else if (candidate.priority > self.best_candidate.priority) {
            use_new_candidate = true;
        }
        if (use_new_candidate) {
            dbg.log0('ICE BESTER CANDIDATE', candidate.key, self.connid);
            self.best_candidate = candidate;
        }
    }
    // close all sessions with less attractive remote candidate
    _.each(self.sessions, function(session) {
        if (session.closed) return;
        if (self.best_candidate.priority > session.remote.priority) {
            session.close();
        }
    });
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
        stun_url = _.isString(stun_url) ? url_utils.quick_parse(stun_url) : stun_url;
        // this request is to public server and we need to know that
        // when processing the response to not require it to include credentials,
        // while the peer stun messages will be required to include it.
        // send "minimal candidates" like local and remote
        var session = self._new_session({
            udp: udp
        }, {
            is_stun_server: true,
            address: stun_url.hostname,
            port: stun_url.port
        });
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
                session.close(err);
            });
    }));
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
    if (frags[0] !== this.local_credentials.ufrag ||
        frags[1] !== this.remote_credentials.ufrag ||
        attr_map.password !== this.local_credentials.pwd) {
        return false;
    }

    return true;
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
        value: this.remote_credentials.ufrag + ':' + this.local_credentials.ufrag
    }, {
        type: stun.ATTRS.PASSWORD,
        value: this.remote_credentials.pwd
    }], buffer);
};


Ice.prototype.close = function() {
    var self = this;
    if (self.closed) return;
    self.closed = true;
    self.emit('close');
    _.each(self.sessions, function(session) {
        session.close();
    });
};


function IceCandidate(cand) {
    // the key is used finding duplicates or locating the candidate
    // on successful connect check, so is crucial to identify exactly
    // the needed properties, not less, and no more.
    cand.key = make_href(cand.transport, cand.family, cand.address, cand.port);
    cand.priority =
        (ip_module.isPrivate(cand.address) ? 1 : 0) << 3 |
        (cand.transport === 'tcp' ? 1 : 0) << 2 |
        (cand.family === 'IPv4' ? 1 : 0) << 1 |
        (cand.tcp_type !== CAND_TCP_TYPE_SO ? 1 : 0) << 0;
    return cand;
}

function IceSession(ice, local, remote, packet) {
    this.ice = ice;
    this.local = local;
    this.remote = remote;
    var attrs;
    if (!packet && !remote.is_stun_server) {
        attrs = [{
            type: stun.ATTRS.XOR_MAPPED_ADDRESS,
            value: {
                family: remote.family,
                address: remote.address,
                port: remote.port,
            }
        }, {
            type: stun.ATTRS.USERNAME,
            value: ice.remote_credentials.ufrag + ':' + ice.local_credentials.ufrag
        }, {
            type: stun.ATTRS.PASSWORD,
            value: ice.remote_credentials.pwd
        }];
    }
    this.packet = packet || stun.new_packet(stun.METHODS.REQUEST, attrs);
    this.tid = stun.get_tid_field(this.packet).toString('base64');
    this.defer = P.defer();
    js_utils.self_bind(this, 'send_udp_request_loop');
    js_utils.self_bind(this, 'send_udp_indication_loop');
}

IceSession.prototype.close = function(err) {
    this.defer.reject(err || new Error('ICE SESSION CLOSED'));
    this.closed = true;
};

IceSession.prototype.send_udp_request_loop = function() {
    if (this.ice.closed) return;
    if (this.closed) return;
    this.local.udp.send_outbound(this.packet, this.remote.port, this.remote.address);
    return P.delay(100).then(this.send_udp_request_loop);
};

IceSession.prototype.send_udp_indication_loop = function() {
    if (this.ice.closed) return;
    if (this.closed) return;
    if (!this.indication) {
        // indication packet copy tid from request packet, not sure if needed,
        // but seems like it would make sense to the stun server
        // to see the indications coming from the same tid session.
        this.indication = stun.new_packet(stun.METHODS.INDICATION, null, this.packet);
    }
    this.local.udp.send_outbound(this.indication, this.remote.port, this.remote.address);
    return P.delay(stun.INDICATION_INTERVAL * chance.floating(stun.INDICATION_JITTER))
        .then(this.send_udp_indication_loop);
};

function make_href(transport, family, address, port) {
    return transport +
        (family === 'IPv6' ?
            '6://[' + address + ']:' :
            '4://' + address + ':') +
        port;
}
