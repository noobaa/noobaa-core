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

    // sessions map, the map by tid use the key of the stun tid's
    // which will allow to match the replies to the requests
    self.sessions_by_key = {};
    self.sessions_by_tid = {};
    self.stun_server_sessions_by_tid = {};

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
    self.remote_credentials = {};
    self.local_candidates = {};
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

    // mark the connect side as controlling, which means I will be the one
    // choosing the best connection to use.
    self.controlling = true;

    P.fcall(function() {

            dbg.log0('ICE CONNECT START', self.connid);
            return self._add_local_candidates();
        })
        .then(function(local_info) {

            // send local info using the signaller
            dbg.log0('ICE CONNECT LOCAL INFO', local_info.credentials,
                _.keys(local_info.candidates), self.connid);
            return self.config.signaller(self.signal_target, local_info);
        })
        .then(function(remote_info) {

            dbg.log0('ICE CONNECT REMOTE INFO', remote_info.credentials,
                _.keys(remote_info.candidates), self.connid);
            self.remote_credentials = remote_info.credentials;
            _.each(remote_info.candidates, function(remote_candidate) {
                self._add_remote_candidate(remote_candidate);
            });
        })
        .fail(function(err) {
            self.emit('error', err);
        })
        .done();
};


/**
 *
 * accept
 *
 * returns promise to the local info (credentials and candidates)
 * to be sent back as reply to the signaller call.
 * in the background it starts to try connecting.
 */
Ice.prototype.accept = function(remote_info) {
    var self = this;

    return P.fcall(function() {

            dbg.log0('ICE ACCEPT REMOTE INFO', remote_info.credentials,
                _.keys(remote_info.candidates), self.connid);
            self.remote_credentials = remote_info.credentials;

            return self._add_local_candidates();
        })
        .then(function(local_info) {

            // the timeout here is needed to give time for the signal response
            // with my local credentials to arrive to the connecting peer.
            setTimeout(function() {
                _.each(remote_info.candidates, function(remote_candidate) {
                    self._add_remote_candidate(remote_candidate);
                });
            }, 100);

            // return my local info over the signal
            // for the peer to be able to simultaneously run the checks.
            dbg.log0('ICE ACCEPT LOCAL INFO', local_info.credentials,
                _.keys(local_info.candidates), self.connid);
            return local_info;
        })
        .fail(function(err) {
            self.emit('error', err);
            throw err;
        });
};


/**
 * _add_local_candidates
 */
Ice.prototype._add_local_candidates = function() {
    var self = this;
    return P.join(
            self._add_udp_candidates(),
            self._add_tcp_active_candidates(),
            self._add_tcp_random_passive_candidates(),
            self._add_tcp_fixed_passive_candidates(),
            self._add_tcp_so_candidates()
        )
        .then(function() {
            return {
                credentials: self.local_credentials,
                candidates: self.local_candidates
            };
        });
};

/**
 * _add_udp_candidates
 */
Ice.prototype._add_udp_candidates = function() {
    var self = this;

    if (!self.config.udp_socket) return;

    return P.fcall(self.config.udp_socket)
        .then(function(udp) {
            self.udp = udp;
            self._init_udp_connection(udp);

            // we bind the udp socket to all interfaces, so add candidate to each
            _.each(self.networks, function(n, ifcname) {
                self._add_local_candidate({
                    transport: 'udp',
                    family: n.family,
                    address: n.address,
                    port: self.udp.port,
                    type: CAND_TYPE_HOST,
                    ifcname: n.ifcname,
                    internal: n.internal, // aka loopback
                });
            });

            return self._add_stun_servers_candidates(udp);
        });
};


/**
 * _add_tcp_active_candidates
 */
Ice.prototype._add_tcp_active_candidates = function() {
    var self = this;
    if (!self.config.tcp_active) return;
    _.each(self.networks, function(n, ifcname) {
        self._add_local_candidate({
            transport: 'tcp',
            family: n.family,
            address: n.address,
            port: CAND_DISCARD_PORT,
            type: CAND_TYPE_HOST,
            tcp_type: CAND_TCP_TYPE_ACTIVE,
            ifcname: n.ifcname,
            internal: n.internal, // aka loopback
        });
    });
};

/**
 * _add_tcp_random_passive_candidates
 */
Ice.prototype._add_tcp_random_passive_candidates = function() {
    var self = this;
    if (!self.config.tcp_random_passive) return;

    var server = net.createServer(function(conn) {
        if (self.active_session || self.closed) {
            conn.detroy();
            return;
        }
        dbg.log0('ICE TCP ACCEPTED CONNECTION', conn.remoteAddress + ':' + conn.remotePort);
        self._init_tcp_connection(conn);
    });

    function close_server() {
        server.close();
    }

    // easy way to remember to close this server when ICE closes
    self.on('close', close_server);
    self.on('connect', close_server);

    server.on('error', function(err) {
        // TODO listening failed
        dbg.error('ICE TCP SERVER ERROR', err);
    });

    return P.ninvoke(server, 'listen').then(function() {
        var address = server.address();
        _.each(self.networks, function(n, ifcname) {
            self._add_local_candidate({
                transport: 'tcp',
                family: n.family,
                address: n.address,
                port: address.port,
                type: CAND_TYPE_HOST,
                tcp_type: CAND_TCP_TYPE_PASSIVE,
                ifcname: n.ifcname,
                internal: n.internal, // aka loopback
            });
        });
    });
};

/**
 * _add_tcp_fixed_passive_candidates
 */
Ice.prototype._add_tcp_fixed_passive_candidates = function() {
    var self = this;
    if (!self.config.tcp_fixed_passive) return;

    // TODO implement tcp_fixed_passive
};

/**
 * _add_tcp_so_candidates
 */
Ice.prototype._add_tcp_so_candidates = function() {
    var self = this;
    if (!self.config.tcp_so) return;
    return P.all(_.map(self.networks, function(n, ifcname) {
        // we create a temp tcp server and listen just to allocate
        // a random port, and then immediately close it
        var server = net.createServer();
        return P.ninvoke(server, 'listen').then(function() {
            var address = server.address();
            server.close();
            self._add_local_candidate({
                transport: 'tcp',
                family: n.family,
                address: n.address,
                port: address.port,
                type: CAND_TYPE_HOST,
                tcp_type: CAND_TCP_TYPE_SO,
                ifcname: n.ifcname,
                internal: n.internal, // aka loopback
            });
        });
    }));
};


/**
 *
 * _add_local_candidate
 *
 */
Ice.prototype._add_local_candidate = function(candidate) {
    var self = this;
    var local = new IceCandidate(candidate);
    if (self.local_candidates[local.key]) return;

    dbg.log0('ICE ADDED LOCAL CANDIDATE', local.key, self.connid);
    self.local_candidates[local.key] = local;

    // match each remote against the new local candidate
    _.each(self.remote_candidates, function(remote) {
        self._check_connectivity(local, remote);
    });
};



/**
 *
 * _add_remote_candidate
 *
 */
Ice.prototype._add_remote_candidate = function(candidate) {
    var self = this;
    var remote = new IceCandidate(candidate);
    if (self.remote_candidates[remote.key]) return;

    dbg.log0('ICE ADDED REMOTE CANDIDATE', remote.key, self.connid);
    self.remote_candidates[remote.key] = remote;

    // match each local against the new remote candidate
    _.each(self.local_candidates, function(local) {
        self._check_connectivity(local, remote);
    });
};


/**
 *
 * _check_connectivity
 *
 */
Ice.prototype._check_connectivity = function(local, remote) {
    var session = this._add_session_if_not_exists(local, remote);
    if (!session) return;
    if (!session.is_init()) return;
    session.mark_checking();

    // start connecting the seesion
    dbg.log0('ICE CHECKING CONNECTIVITY', session.key, this.connid);
    if (local.transport === 'tcp') {
        if (local.tcp_type === CAND_TCP_TYPE_SO) {
            this._connect_tcp_so_pair(session);
        } else {
            this._connect_tcp_active_passive_pair(session);
        }
    } else {
        session.run_udp_request_loop();
    }
};


/**
 *
 * _add_session_if_not_exists
 *
 */
Ice.prototype._add_session_if_not_exists = function(local, remote) {
    var self = this;

    // check if exists already by the session key
    // if exists and still valid then keep using it,
    // otherwise override it
    var session_key = make_session_key(local, remote);
    var existing = self.sessions_by_key[session_key];
    if (existing && !existing.is_closed()) return existing;

    // TODO should we support foundation and frozen candidates from the SPEC?
    if (self.config.accept_ipv4 === false && remote.family === 'IPv4') return;
    if (self.config.accept_ipv6 === false && remote.family === 'IPv6') return;
    if (local.family !== remote.family) return;
    if (local.transport !== remote.transport) return;
    if (local.tcp_type === CAND_TCP_TYPE_PASSIVE) return;
    if (local.tcp_type === CAND_TCP_TYPE_ACTIVE &&
        remote.tcp_type !== CAND_TCP_TYPE_PASSIVE) return;
    if (local.tcp_type === CAND_TCP_TYPE_SO &&
        remote.tcp_type !== CAND_TCP_TYPE_SO) return;

    var session;
    do {
        session = new IceSession(local, remote, self._make_stun_request_response(remote), self.udp);
    } while (self.sessions_by_tid[session.tid]);
    self.sessions_by_key[session.key] = session;
    self.sessions_by_tid[session.tid] = session;
    dbg.log0('ICE ADDED SESSION', session.key, self.connid);

    return session;
};


/**
 *
 * _connect_tcp_active_passive_pair
 *
 */
Ice.prototype._connect_tcp_active_passive_pair = function(session) {
    var self = this;
    const MAX_ATTEMPTS = 10;
    var attempts = 0;
    var delay = 250;
    var try_ap = function() {
        if (self.active_session || self.closed || session.is_closed()) {
            dbg.log0('ICE TCP AP STOPPED', session.key);
            session.close(new Error('ICE TCP AP STOPPED'));
            return;
        } else if (attempts >= MAX_ATTEMPTS) {
            dbg.warn('ICE TCP AP FAILED', session.key);
            session.close(new Error('ICE TCP AP EXHAUSTED'));
            return;
        }
        session.tcp = net.connect(session.remote.port, session.remote.address);
        session.tcp.on('error', function(err) {
            session.tcp.destroy();
            setTimeout(try_ap, delay);
            attempts += 1;
        });
        session.tcp.on('connect', function(err) {
            dbg.log0('ICE TCP AP CONNECTED', session.key, 'took', attempts, 'attempts');
            attempts = MAX_ATTEMPTS;
            if (self.active_session || self.closed || session.is_closed()) {
                session.tcp.destroy();
                return;
            }
            self._init_tcp_connection(session.tcp, session);
            session.tcp.frame_stream.send_message(session.packet, ICE_FRAME_STUN_MSG_TYPE);
        });
    };
    try_ap();
};


/**
 *
 * _connect_tcp_so_pair
 *
 */
Ice.prototype._connect_tcp_so_pair = function(session) {
    var self = this;
    const MAX_ATTEMPTS = 200;
    var attempts = 0;
    var delay = 50;
    var so_connect_conf = {
        port: session.remote.port,
        address: session.remote.address,
        localPort: session.local.port
    };
    var try_so = function() {
        if (self.active_session || self.closed || session.is_closed()) {
            dbg.log0('ICE TCP SO STOPPED', session.key);
            session.close(new Error('ICE TCP SO STOPPED'));
            return;
        } else if (attempts >= MAX_ATTEMPTS) {
            dbg.warn('ICE TCP SO FAILED', session.key);
            session.close(new Error('ICE TCP SO EXHAUSTED'));
            return;
        }
        session.tcp = net.connect(so_connect_conf);
        session.tcp.on('error', function(err) {
            session.tcp.destroy();
            setTimeout(try_so, delay);
            attempts += 1;
            if (delay > 10) {
                delay *= 0.9;
            }
        });
        session.tcp.on('connect', function(err) {
            dbg.log0('ICE TCP SO CONNECTED', session.key, 'took', attempts, 'attempts');
            attempts = MAX_ATTEMPTS;
            if (self.active_session || self.closed || session.is_closed()) {
                session.tcp.destroy();
                return;
            }
            self._init_tcp_connection(session.tcp, session);
            // after the connection is made, we prefer just one req-res
            // so we make only the controlling send the request.
            if (self.controlling) {
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
    self.on('close', close_conn);
    // TODO handld udp socket close
    conn.on('close', close_conn);
    // TODO handld udp socket error
    conn.on('error', close_conn);

    function close_conn(err) {
        if (err) {
            dbg.error('ICE UDP CLOSING', err || '');
        }
        conn.close();
    }

    // TODO limit udp that receives only non-stun messages
    conn.on('stun', function(buffer, info) {
        info.udp = conn;
        info.transport = 'udp';
        info.key = make_candidate_key('udp', info.family, info.address, info.port);
        self._handle_stun_packet(buffer, info);
    });
};


/**
 * _init_tcp_connection
 */
Ice.prototype._init_tcp_connection = function(conn, session) {
    var self = this;
    var info = {
        family: conn.remoteFamily,
        address: conn.remoteAddress,
        port: conn.remotePort,
        tcp: conn,
        transport: 'tcp',
        session: session,
        key: make_candidate_key('tcp', conn.remoteFamily, conn.remoteAddress, conn.remotePort)
    };

    var temp_queue = [];

    // easy way to remember to close this connection when ICE closes
    self.on('close', destroy_conn);
    // TODO remove ice tcp conn candidates on error
    conn.on('close', destroy_conn);
    conn.on('error', destroy_conn);
    // TODO set timeout to detect idle connection
    conn.on('timeout', destroy_conn);

    function destroy_conn(err) {
        if (err) {
            dbg.error('ICE TCP DESTROYING', err || '');
        }
        temp_queue = null;
        conn.destroy();
        if (info.session) {
            info.session.close(err || new Error('ICE TCP DESTROYING'));
        }
    }

    // we keep a message queue until the 'message' listener will be added
    // to the connection because there is a short time that only one peer
    // knows the connection is fully active, and the other peer still did
    // not receive the response to the activate request.
    // the first peer might send messages during that time and since there is
    // no event handler installed yet then these messages will get lost.
    // we solve by queueing them, and unleashing once the handler is added.
    conn.on('newListener', function new_listener_handler(event) {
        if (event !== 'message') return;
        dbg.log('ICE TCP UNLEASH', temp_queue.length, 'QUEUED MESSAGES', info.key);
        conn.removeListener('newListener', new_listener_handler);
        var mq = temp_queue;
        temp_queue = null;
        for (var i = 0; i < mq.length; ++i) {
            conn.emit('message', mq[i]);
        }
    });

    conn.frame_stream = new FrameStream(conn, function(buffer, msg_type) {
        if (msg_type === ICE_FRAME_STUN_MSG_TYPE) {
            self._handle_stun_packet(buffer, info);
            return;
        }
        if (!temp_queue) {
            conn.emit('message', buffer);
            return;
        }
        // limit tcp that receives non-stun messages before
        // proper connection is established and the 'message' listener is added
        if (temp_queue.length > 30) {
            destroy_conn(new Error('ICE TCP TOO MANY QUEUED MESSAGES'));
            return;
        }
        temp_queue.push(buffer);
        dbg.log0('ICE TCP HOLDING MESSAGE IN QUEUE FOR LISTENER',
            temp_queue.length, info.key);
    }, ICE_FRAME_CONFIG);
};


/**
 * _find_session_to_activate
 */
Ice.prototype._find_session_to_activate = function() {

    // only the controlling chooses sessions
    if (!this.controlling) return;
    if (this.closed) return;

    var best_session;
    var highest_non_closed_priority = -Infinity;

    // close all sessions with less attractive remote candidate
    _.each(this.sessions_by_tid, function(session) {
        if (session.is_closed()) return;
        if (session.remote.priority > highest_non_closed_priority) {
            highest_non_closed_priority = session.remote.priority;
        }
        if (!session.is_ready()) return;
        if (!best_session) {
            best_session = session;
        } else {
            // in case of priority tie, we pick in arbitrary way to break tie
            // so here we compare key lexical order
            if (session.remote.priority === best_session.remote.priority) {
                if (session.key > best_session.key) {
                    best_session = session;
                }
            } else if (session.remote.priority > best_session.remote.priority) {
                best_session = session;
            }
        }
    });
    if (highest_non_closed_priority <= best_session.remote.priority) {
        this._activate_session(best_session);
    }
};

/**
 * _activate_session
 */
Ice.prototype._activate_session = function(session) {
    if (this.closed) return;
    if (this.activating_session) return;
    this.activating_session = session;

    dbg.log0('ICE SESSION ACTIVATING', session.key);

    var activate_packet = stun.new_packet(stun.METHODS.REQUEST, [{
        type: stun.ATTRS.USE_CANDIDATE,
        value: '1'
    }, {
        type: this.controlling ? stun.ATTRS.ICE_CONTROLLING : stun.ATTRS.ICE_CONTROLLED,
        value: '1'
    }, {
        type: stun.ATTRS.USERNAME,
        value: this.remote_credentials.ufrag + ':' + this.local_credentials.ufrag
    }, {
        type: stun.ATTRS.PASSWORD,
        value: this.remote_credentials.pwd
    }, {
        type: stun.ATTRS.XOR_MAPPED_ADDRESS,
        value: {
            family: session.remote.family,
            address: session.remote.address,
            port: session.remote.port,
        }
    }], session.packet);

    session.mark_activating(activate_packet);

    if (session.tcp) {
        session.tcp.frame_stream.send_message(session.packet, ICE_FRAME_STUN_MSG_TYPE);
    } else {
        session.run_udp_request_loop();
    }
};


/**
 * _activate_session_complete
 */
Ice.prototype._activate_session_complete = function(session) {
    var self = this;
    if (self.closed) return;
    if (self.active_session) return;
    dbg.log0('ICE SESSION ACTIVE', session.key);
    self.active_session = session;
    session.mark_active();
    session.on('close', function() {
        self.close();
    });
    _.each(self.sessions_by_tid, function(s) {
        if (s !== session) {
            s.close();
        }
    });
    self.emit('connect', session);
};


/**
 *
 * _handle_stun_packet
 *
 */
Ice.prototype._handle_stun_packet = function(buffer, info) {
    var method = stun.get_method_field(buffer);

    if (this.closed) {
        return this._bad_stun_packet(buffer, info,
            'PACKET ON CLOSED ICE ' + method);
    }

    // TODO implement stun message integrity check with HMAC

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
        dbg.warn('ICE _bad_stun_packet:', reason, info.key, this.connid);
        info.tcp.destroy();
    } else {
        // udp silently ignore to avoid denial of service
        // TODO maybe better fail and restart a new ICE on random port?
        info.udp.num_bad_stun = 1 + (info.udp.num_bad_stun || 0);
        if (info.udp.num_bad_stun > 100) {
            dbg.warn('ICE _bad_stun_packet: too many udp errors', reason, info.key, this.connid);
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
    // since this is not meant to be general stun server.
    var attr_map = stun.get_attrs_map(buffer);
    if (!this._check_stun_credentials(attr_map)) {
        return this._bad_stun_packet(buffer, info, 'REQUEST WITH BAD CREDENTIALS');
    }

    dbg.log0('ICE STUN REQUEST FROM', info.key);

    if (!attr_map.address) {
        return this._bad_stun_packet(buffer, info, 'REQUEST MISSING ADDRESS');
    }
    if ((attr_map.ice_controlling && this.controlling) ||
        (attr_map.ice_controlled && !this.controlling)) {
        return this._bad_stun_packet(buffer, info, 'REQUEST WITH BAD CONTROLLING STATE');
    }

    if (!info.session) {
        // add session based on the addresses
        info.session = this._add_session_if_not_exists(new IceCandidate({
            transport: info.transport,
            family: info.family, // make it match instead of attr_map.address.family,
            address: attr_map.address.address,
            port: attr_map.address.port,
            type: CAND_TYPE_PEER_REFLEX,
        }), new IceCandidate({
            transport: info.transport,
            family: info.family,
            address: info.address,
            port: info.port,
            type: CAND_TYPE_PEER_REFLEX,
        }));
        // dbg.log0('GGG session', info.session, attr_map.address, info);
    }
    if (info.session) {
        if (info.tcp && !info.tcp.destroyed &&
            (!info.session.tcp || info.session.tcp.destroyed)) {
            info.session.tcp = info.tcp;
        }
        if (info.session.mark_ready()) {
            dbg.log0('ICE SESSION READY (REQUESTED)', info.session.key, this.connid);
            this._find_session_to_activate();
        }
        if (attr_map.use_candidate) {
            this._activate_session_complete(info.session);
        }
    }

    // send stun response
    var reply = this._make_stun_request_response(info, buffer, attr_map.use_candidate);
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
    var attr_map;

    // lookup the tid in the pending requests
    var tid = stun.get_tid_field(buffer).toString('base64');
    var session = this.sessions_by_tid[tid];

    // check if this is a response from stun server
    if (!session) {
        session = this.stun_server_sessions_by_tid[tid];
        if (!session) {
            return this._bad_stun_packet(buffer, info, 'RESPONSE TO MISSING SESSION');
        }
        if (session.is_closed()) {
            return this._bad_stun_packet(buffer, info, 'RESPONSE TO CLOSED SESSION');
        }
        dbg.log0('ICE STUN RESPONSE FROM SERVER', info.key);
        // add a local candidate from the stun mapped address field
        attr_map = stun.get_attrs_map(buffer);
        if (attr_map.address) {
            this._add_local_candidate({
                transport: info.transport,
                family: attr_map.address.family,
                address: attr_map.address.address,
                port: attr_map.address.port,
                type: CAND_TYPE_SERVER_REFLEX,
            });
        }
        session.mark_ready();
        return;
    }

    if (session.is_closed()) {
        return this._bad_stun_packet(buffer, info, 'RESPONSE TO CLOSED SESSION');
    }

    dbg.log0('ICE STUN RESPONSE FROM PEER', info.key);

    attr_map = stun.get_attrs_map(buffer);
    if (!this._check_stun_credentials(attr_map)) {
        session.close(new Error('ICE STUN RESPONSE BAD CREDENTIALS'));
        return this._bad_stun_packet(buffer, info, 'RESPONSE WITH BAD CREDENTIALS');
    }
    if (!attr_map.address) {
        session.close(new Error('ICE STUN RESPONSE WITHOUT ADDRESS'));
        return this._bad_stun_packet(buffer, info, 'RESPONSE WITHOUT ADDRESS');
    }
    if ((attr_map.ice_controlling && this.controlling) ||
        (attr_map.ice_controlled && !this.controlling)) {
        return this._bad_stun_packet(buffer, info, 'REQUEST WITH BAD CONTROLLING STATE');
    }

    if (!info.session) {
        info.session = session;
    }
    var changed = false;
    if (info.session && info.session.mark_ready()) {
        dbg.log0('ICE SESSION READY (RESPONDED)', session.key, this.connid);
        changed = true;
    }
    if (session.mark_ready()) {
        dbg.log0('ICE SESSION READY (RESPONDED)', session.key, this.connid);
        changed = true;
    }
    if (changed) {
        this._find_session_to_activate();
    }
    if (attr_map.use_candidate) {
        this._activate_session_complete(session);
    }
};


/**
 *
 * _add_stun_servers_candidates
 *
 * sending stun requests to public servers to discover my address outside of the NAT
 * and keep the stun mapping open after by sending indications periodically.
 *
 */
Ice.prototype._add_stun_servers_candidates = function(udp) {
    var self = this;
    return P.all(_.map(self.config.stun_servers, function(stun_url) {
        stun_url = _.isString(stun_url) ? url_utils.quick_parse(stun_url) : stun_url;
        // this request is to public server and we need to know that
        // when processing the response to not require it to include credentials,
        // while the peer stun messages will be required to include it.
        var session;
        var family = net.isIPv6(stun_url.hostname) ? 'IPv6' : 'IPv4';
        do {
            // create "minimal candidates" local and remote
            session = new IceSession(self, {
                family: family,
                address: '0.0.0.0',
                port: self.udp.port
            }, {
                family: family,
                address: stun_url.hostname,
                port: stun_url.port
            }, stun.new_packet(stun.METHODS.REQUEST), self.udp);
        } while (self.stun_server_sessions_by_tid[session.tid]);
        self.stun_server_sessions_by_tid[session.tid] = session;
        // send udp requests until replied
        session.run_udp_request_loop();
        // the stun response will add the local candidate and wake us up
        return session.wait_for().then(function() {
            session.run_udp_indication_loop();
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
 * _make_stun_request_response
 */
Ice.prototype._make_stun_request_response = function(info, request_buffer, use_candidate) {
    return stun.new_packet(
        request_buffer ? stun.METHODS.SUCCESS : stun.METHODS.REQUEST, [{
            type: this.controlling ? stun.ATTRS.ICE_CONTROLLING : stun.ATTRS.ICE_CONTROLLED,
            value: '1'
        }, use_candidate && {
            type: stun.ATTRS.USE_CANDIDATE,
            value: '1'
        }, {
            type: stun.ATTRS.USERNAME,
            value: this.remote_credentials.ufrag + ':' + this.local_credentials.ufrag
        }, {
            type: stun.ATTRS.PASSWORD,
            value: this.remote_credentials.pwd
        }, {
            type: stun.ATTRS.XOR_MAPPED_ADDRESS,
            value: {
                family: info.family,
                address: info.address,
                port: info.port,
            }
        }], request_buffer);
};


Ice.prototype.close = function() {
    var self = this;
    if (self.closed) return;
    self.closed = true;
    self.emit('close');
    _.each(self.sessions_by_tid, function(session) {
        session.close();
    });
    _.each(self.stun_server_sessions_by_tid, function(session) {
        session.close();
    });
};


function IceCandidate(cand) {
    // the key is used finding duplicates or locating the candidate
    // on successful connect check, so is crucial to identify exactly
    // the needed properties, not less, and no more.
    cand.key = make_candidate_key(cand.transport, cand.family, cand.address, cand.port);
    cand.priority =
        (ip_module.isPrivate(cand.address) ? 1 : 0) << 3 |
        (cand.transport === 'tcp' ? 1 : 0) << 2 |
        (cand.family === 'IPv4' ? 1 : 0) << 1 |
        (cand.tcp_type !== CAND_TCP_TYPE_SO ? 1 : 0) << 0;
    return cand;
}

util.inherits(IceSession, EventEmitter);

function IceSession(local, remote, packet, udp) {
    var self = this;
    EventEmitter.call(self);
    self.local = local;
    self.remote = remote;
    self.packet = packet;
    self.udp = udp;
    self.key = make_session_key(local, remote);
    self.tid = stun.get_tid_field(self.packet).toString('base64');
    self.state = 'init';
    js_utils.self_bind(self, 'run_udp_request_loop');
    js_utils.self_bind(self, 'run_udp_indication_loop');
    self.defer = P.defer();
    self.defer.promise.fail(_.noop); // to ignore 'Unhandled rejection' printouts
    // set session timeout
    self.ready_timeout = setTimeout(function() {
        self.close(new Error('ICE SESSION TIMEOUT'));
    }, 5000);
}

IceSession.prototype.is_init = function() {
    return this.state === 'init';
};
IceSession.prototype.is_ready = function() {
    return this.state === 'ready';
};
IceSession.prototype.is_closed = function() {
    return this.state === 'closed';
};
IceSession.prototype.wait_for = function() {
    return this.defer.promise;
};

IceSession.prototype.mark_checking = function() {
    switch (this.state) {
        case 'closed':
            throw new Error('ICE SESSION STATE CLOSED');
        case 'init':
            break;
        default:
            return;
    }
    if (this.state === 'closed') throw new Error('ICE SESSION STATE CLOSED');
    if (this.state !== 'init') return;
    this.state = 'checking';
};

IceSession.prototype.mark_ready = function() {
    switch (this.state) {
        case 'closed':
            throw new Error('ICE SESSION STATE CLOSED');
        case 'init':
        case 'checking':
            break;
        default:
            return;
    }
    this.state = 'ready';
    clearTimeout(this.ready_timeout);
    this.ready_timeout = null;
    this.defer.resolve();
    return true;
};

IceSession.prototype.mark_activating = function(packet) {
    var self = this;
    switch (self.state) {
        case 'closed':
            throw new Error('ICE SESSION STATE CLOSED');
        case 'activating':
        case 'active':
            return;
        default:
            break;
    }
    self.state = 'activating';
    self.packet = packet;
    // mark this session as waiting for connect response
    self.activating_timeout = setTimeout(function() {
        self.close(new Error('ICE SESSION CONNECT TIMEOUT'));
    }, 5000);
    return true;
};

IceSession.prototype.mark_active = function() {
    switch (this.state) {
        case 'closed':
            throw new Error('ICE SESSION STATE CLOSED');
        case 'active':
            return;
        default:
            break;
    }
    this.state = 'active';
    clearTimeout(this.activating_timeout);
    this.activating_timeout = null;
    return true;
};

IceSession.prototype.close = function(err) {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.emit('close');
    this.defer.reject(err || new Error('ICE SESSION CLOSED'));
    clearTimeout(this.ready_timeout);
    this.ready_timeout = null;
    clearTimeout(this.activating_timeout);
    this.activating_timeout = null;
    if (this.tcp) {
        this.tcp.destroy();
    }
};

IceSession.prototype.run_udp_request_loop = function() {
    if (this.state !== 'checking' && this.state !== 'activating') return;
    this.udp.send_outbound(this.packet, this.remote.port, this.remote.address, _.noop);
    setTimeout(this.run_udp_request_loop, 100);
};

IceSession.prototype.run_udp_indication_loop = function() {
    if (this.state !== 'ready') return;
    if (!this.indication) {
        // indication packet copy tid from request packet, not sure if needed,
        // but seems like it would make sense to the stun server
        // to see the indications coming from the same tid session.
        this.indication = stun.new_packet(stun.METHODS.INDICATION, null, this.packet);
    }
    this.udp.send_outbound(this.indication, this.remote.port, this.remote.address, _.noop);
    var delay = stun.INDICATION_INTERVAL * chance.floating(stun.INDICATION_JITTER);
    setTimeout(this.run_udp_indication_loop, delay);
};

function make_candidate_key(transport, family, address, port) {
    return transport +
        (family === 'IPv6' ?
            '://[' + address + ']:' :
            '://' + address + ':') +
        port;
}

function make_session_key(local, remote) {
    return local.key + '=>' + remote.key;
    // return 'local=>' + remote.key;
}
