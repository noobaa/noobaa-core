/* Copyright (C) 2016 NooBaa */
/* eslint max-lines: ['error', 1550] */
'use strict';

module.exports = Ice;

const _ = require('lodash');
const P = require('../util/promise');
const os = require('os');
const net = require('net');
const tls = require('tls');
const util = require('util');
const crypto = require('crypto');
const chance = require('chance')();
const events = require('events');
const ip_module = require('ip');

const dbg = require('../util/debug_module')(__filename);
const stun = require('./stun');
const js_utils = require('../util/js_utils');
const url_utils = require('../util/url_utils');
const FrameStream = require('../util/frame_stream');
const buffer_utils = require('../util/buffer_utils');


const CAND_TYPE_HOST = 'host';
const CAND_TYPE_SERVER_REFLEX = 'server';
const CAND_TYPE_PEER_REFLEX = 'peer';
const CAND_DISCARD_PORT = 0;
const CAND_TCP_TYPE_ACTIVE = 'active';
const CAND_TCP_TYPE_PASSIVE = 'passive';
const CAND_TCP_TYPE_SO = 'so';

const ICE_UFRAG_LENGTH = 32; // ice rfc uses 4
const ICE_PWD_LENGTH = 32; // ice rfc uses 22
const RAND_ICE_CHAR_POOL_64 =
    'abcdefghijklmnopqrstuvwxyz' +
    'ABCDEFGHIJKLMNOPQRTTUVWXYZ' +
    '0123456789+/';

const ICE_FRAME_CONFIG = {
    magic: 'ICEmagic'
};
const ICE_FRAME_STUN_MSG_TYPE = 1;

util.inherits(Ice, events.EventEmitter);

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
 *  ssl_options: (object)
 *      should contain ssl options: key, cert, ca, etc.
 *      see https://nodejs.org/api/tls.html#tls_tls_connect_options_callback
 *
 *  tcp_tls: (boolean)
 *      when provided will upgrade to TLS after ICE connects
 *  tcp_active: (boolean)
 *      this endpoint will offer to connect using tcp.
 *  tcp_permanent_passive: (bool | object with port number or port range object)
 *      this endpoint will listen on tcp port
 *      and will keep the server shared with other ICE connections.
 *      the provided object should have a port property (integer)
 *      or port_range property (object with min,max integers)
 *      and will be used to keep the shared server.
 *  tcp_transient_passive: (bool | object with port number or port range object)
 *      this endpoint will listen on tcp port
 *      and will be used only by this ICE instance.
 *  tcp_simultaneous_open: (boolean / port number / port range object)
 *      simultaneous_open means both endpoints will connect simultaneously,
 *      see https://en.wikipedia.org/wiki/TCP_hole_punching
 *
 *  udp_port: (boolean / port number / port range object)
 *  udp_dtls: (boolean)
 *  udp_socket: (function(udp_port, dtls))
 *      used to create a udp socket and bind it to a port (random typically).
 *      the returned object can send packets using send(buffer,port,host),
 *      and once messages are received it should detect stun messages (see in stun.js)
 *      and call emit 'stun' events on received stun packet to be handled by ICE.
 *
 *  stun_servers: (array of urls or promises to urls)
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
    events.EventEmitter.call(self);
    self.setMaxListeners(100);

    // connid is provided externally for debugging
    self.connid = connid;

    // config object for ICE (see detailed list in the doc above)
    self.config = config;

    // to be passed as the target when calling the signaller
    self.signal_target = signal_target;

    // sessions by key for uniqueness - see make_session_key
    self.sessions_by_key = {};

    // sessions map, the map by tid use the key of the stun tid's
    // which will allow to match the replies to the requests
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
            // for the nodes internal ip - add public_ips as another network interface. take same parameters as internal ip
            if (n.address === ip_module.address() &&
                config.public_ips.length) {
                config.public_ips.forEach(ip => {
                    if (ip === n.address) return;
                    const public_n = _.clone(n);
                    public_n.address = ip;
                    public_n.ifcname = 'public_' + name;
                    self.networks.push(public_n);
                });
            }
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
        dbg.log0('ICE CLOSE ON ERROR', err.stack || err);
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

            dbg.log3('ICE CONNECT START', self.connid);
            return self._add_local_candidates();
        })
        .then(function(local_info) {

            // send local info using the signaller
            dbg.log3('ICE CONNECT LOCAL INFO', local_info.credentials,
                _.keys(local_info.candidates), self.connid);
            return self.config.signaller(self.signal_target, local_info);
        })
        .then(function(remote_info) {

            dbg.log3('ICE CONNECT REMOTE INFO', remote_info.credentials,
                _.keys(remote_info.candidates), self.connid);
            self.remote_credentials = remote_info.credentials;
            _.each(remote_info.candidates, function(remote_candidate) {
                self._add_remote_candidate(remote_candidate);
            });

            setTimeout(function() {
                self._find_session_to_activate('force');
            }, 3000);
        })
        .catch(function(err) {
            self.emit('error', err);
        });
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

            dbg.log3('ICE ACCEPT REMOTE INFO', remote_info.credentials,
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
            dbg.log3('ICE ACCEPT LOCAL INFO', local_info.credentials,
                _.keys(local_info.candidates), self.connid);
            return local_info;
        })
        .catch(function(err) {
            self.emit('error', err);
            throw err;
        });
};


/**
 * _add_local_candidates
 */
Ice.prototype._add_local_candidates = function() {
    var self = this;
    return Promise.all([
            self._add_udp_candidates(),
            self._add_tcp_active_candidates(),
            self._add_tcp_permanent_passive_candidates(),
            self._add_tcp_transient_passive_candidates(),
            self._add_tcp_simultaneous_open_candidates()
        ])
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

    if (!self.config.udp_port) return;
    if (!process.env.ENABLE_N2N_UDP) return;

    return P.fcall(self.config.udp_socket, self.config.udp_port, self.config.udp_dtls)
        .then(function(udp) {

            // will be closed by ice.close
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
        })
        .catch(function(err) {
            dbg.warn('ICE _add_udp_candidates: FAILED', err);
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
 * _add_tcp_permanent_passive_candidates
 *
 * the permanent mode creates a shared tcp server used by multiple ICE sessions.
 * the server is created and maintained inside the config object,
 * and other ICE isntances using the same config will share the server.
 */
Ice.prototype._add_tcp_permanent_passive_candidates = function() {
    var self = this;
    if (!self.config.tcp_permanent_passive) return;
    var conf = self.config.tcp_permanent_passive;

    return P.fcall(function() {
            // register my credentials in ice_map
            if (!conf.ice_map) {
                conf.ice_map = {};
            }
            var my_ice_key = self.local_credentials.ufrag + self.local_credentials.pwd;
            conf.ice_map[my_ice_key] = self;
            self.on('close', remove_my_from_ice_map);
            self.on('connect', remove_my_from_ice_map);

            function remove_my_from_ice_map() {
                delete conf.ice_map[my_ice_key];
            }

            // setup ice_lookup to find the ice instance by stun credentials
            if (!conf.ice_lookup) {
                conf.ice_lookup = function(buffer, info) {
                    var attr_map = stun.get_attrs_map(buffer);
                    var ice_key = attr_map.username.split(':', 1)[0] + attr_map.password;
                    return conf.ice_map[ice_key];
                };
            }

            if (!conf.listen_promise) {
                conf.listen_promise = listen_on_port_range(conf);
                conf.listen_promise.catch(() => {
                    conf.listen_promise = null;
                });
            }
            return conf.listen_promise;
        })
        .then(function(server) {
            // register handlers only if just been created and not in the conf object
            if (!conf.server) {
                conf.server = server;
                server.on('connection', function(conn) {
                    init_tcp_connection(conn, null, null, conf.ice_lookup);
                });
                server.on('close', function() {
                    conf.listen_promise = null;
                    conf.server = null;
                });
            }
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
        })
        .catch(function(err) {
            dbg.warn('ICE _add_tcp_permanent_passive_candidates: FAILED', err);
        });
};

/**
 * _add_tcp_transient_passive_candidates
 */
Ice.prototype._add_tcp_transient_passive_candidates = function() {
    var self = this;
    if (!self.config.tcp_transient_passive) return;
    var conf = self.config.tcp_transient_passive;

    return listen_on_port_range(conf)
        .then(function(server) {
            var address = server.address();

            // remember to close this server when ICE closes
            self.on('close', close_server);
            self.on('connect', close_server);

            function close_server() {
                server.close();
            }

            // handle connections
            server.on('connection', function(conn) {
                if (self.active_session || self.closed) {
                    conn.destroy();
                    return;
                }
                dbg.log3('ICE TCP ACCEPTED CONNECTION', conn.remoteAddress + ':' + conn.remotePort);
                self._init_tcp_connection(conn);
            });

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
        })
        .catch(function(err) {
            dbg.warn('ICE _add_tcp_transient_passive_candidates: FAILED', err);
        });

};

/**
 * _add_tcp_simultaneous_open_candidates
 */
Ice.prototype._add_tcp_simultaneous_open_candidates = function() {
    var self = this;
    if (!self.config.tcp_simultaneous_open) return;
    var conf = self.config.tcp_simultaneous_open;
    return P.all(_.map(self.networks, function(n, ifcname) {
            return allocate_port_in_range(conf)
                .then(function(port) {
                    self._add_local_candidate({
                        transport: 'tcp',
                        family: n.family,
                        address: n.address,
                        port: port,
                        type: CAND_TYPE_HOST,
                        tcp_type: CAND_TCP_TYPE_SO,
                        ifcname: n.ifcname,
                        internal: n.internal, // aka loopback
                    });
                });
        }))
        .catch(function(err) {
            dbg.warn('ICE _add_tcp_simultaneous_open_candidates: FAILED', err);
        });
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

    dbg.log3('ICE ADDED LOCAL CANDIDATE', local.key, self.connid);
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

    dbg.log3('ICE ADDED REMOTE CANDIDATE', remote.key, self.connid);
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
    dbg.log3('ICE CHECKING CONNECTIVITY', session.key, this.connid);
    if (local.transport === 'tcp') {
        if (local.tcp_type === CAND_TCP_TYPE_SO) {
            this._connect_tcp_simultaneous_open_pair(session);
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
    dbg.log3('ICE ADDED SESSION', session.key, self.connid);

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
    try_ap();

    function try_ap() {
        if (self.active_session || self.closed || session.is_closed()) {
            dbg.log1('ICE TCP AP STOPPED', session.key);
            session.close(new Error('ICE TCP AP STOPPED'));
            return;
        } else if (attempts >= MAX_ATTEMPTS) {
            dbg.warn('ICE TCP AP FAILED', session.key);
            session.close(new Error('ICE TCP AP EXHAUSTED'));
            return;
        }
        session.tcp = net.connect(session.remote.port, session.remote.address);
        session.tcp.on('error', function(err) {
            dbg.log0('Got error', err);
            session.tcp.destroy();
            setTimeout(try_ap, delay);
            attempts += 1;
        });
        session.tcp.on('connect', function(err) {
            dbg.log1('ICE TCP AP CONNECTED', session.key, 'took', attempts, 'attempts', err);
            attempts = MAX_ATTEMPTS;
            if (self.active_session || self.closed || session.is_closed()) {
                session.tcp.destroy();
                return;
            }
            self._init_tcp_connection(session.tcp, session);
            session.tcp.frame_stream.send_message([session.packet], ICE_FRAME_STUN_MSG_TYPE);
        });
    }
};


/**
 *
 * _connect_tcp_simultaneous_open_pair
 *
 */
Ice.prototype._connect_tcp_simultaneous_open_pair = function(session) {
    var self = this;
    const MAX_ATTEMPTS = 200;
    var attempts = 0;
    var delay = 50;
    var so_connect_conf = {
        port: session.remote.port,
        address: session.remote.address,
        localPort: session.local.port
    };
    try_so();

    function try_so() {
        if (self.active_session || self.closed || session.is_closed()) {
            dbg.log1('ICE TCP SO STOPPED', session.key);
            session.close(new Error('ICE TCP SO STOPPED'));
            return;
        } else if (attempts >= MAX_ATTEMPTS) {
            dbg.warn('ICE TCP SO FAILED', session.key);
            session.close(new Error('ICE TCP SO EXHAUSTED'));
            return;
        }
        session.tcp = net.connect(so_connect_conf);
        session.tcp.on('error', function(err) {
            dbg.log0('Got error', err);
            session.tcp.destroy();
            setTimeout(try_so, delay);
            attempts += 1;
            if (delay > 10) {
                delay *= 0.9;
            }
        });
        session.tcp.on('connect', function(err) {
            dbg.log1('ICE TCP SO CONNECTED', session.key, 'took', attempts, 'attempts', err);
            attempts = MAX_ATTEMPTS;
            if (self.active_session || self.closed || session.is_closed()) {
                session.tcp.destroy();
                return;
            }
            self._init_tcp_connection(session.tcp, session);
            // after the connection is made, we prefer just one req-res
            // so we make only the controlling send the request.
            if (self.controlling) {
                session.tcp.frame_stream.send_message([session.packet], ICE_FRAME_STUN_MSG_TYPE);
            }
        });
    }
};


/**
 * _init_udp_connection
 */
Ice.prototype._init_udp_connection = function(conn) {
    var self = this;

    // remember to close this connection when ICE closes
    self.on('close', close_conn);
    // TODO handld udp socket close
    conn.on('close', close_conn);
    // TODO handld udp socket error
    conn.on('error', close_conn);

    function close_conn(err) {
        if (err) {
            dbg.log0('ICE UDP CLOSING', err);
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
    // link this connection exclusively to this ice instance
    init_tcp_connection(conn, session, this);
};

/**
 *
 * init_tcp_connection
 *
 * this function is used also for tcp_permanent_passive and this is why
 * it is not in the context of a single ICE instance.
 * see _init_tcp_connection above for an instance wrapper.
 */
function init_tcp_connection(conn, session, ice, ice_lookup) {
    var info = {
        family: conn.remoteFamily,
        address: conn.remoteAddress,
        port: conn.remotePort,
        key: make_candidate_key('tcp', conn.remoteFamily, conn.remoteAddress, conn.remotePort),
        tcp: conn,
        transport: 'tcp',
        session: session,
    };

    var temp_queue = [];

    if (ice) {
        // remember to close this connection when ICE closes
        ice.on('close', destroy_conn);
    }
    // TODO remove ice tcp conn candidates on error
    conn.on('close', destroy_conn);
    conn.on('error', destroy_conn);
    // TODO set timeout to detect idle connection
    conn.on('timeout', destroy_conn);

    function destroy_conn(err) {
        temp_queue = null;
        conn.destroy();
        if (info.session) {
            info.session.close(err || new Error('ICE TCP DESTROYING'));
        } else {
            dbg.log1('ICE TCP DESTROYING', err || '');
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
        dbg.log1('ICE TCP UNLEASH', temp_queue.length, 'QUEUED MESSAGES', info.key);
        conn.removeListener('newListener', new_listener_handler);
        var mq = temp_queue;
        temp_queue = null;
        for (var i = 0; i < mq.length; ++i) {
            conn.emit('message', mq[i]);
        }
    });

    conn.frame_stream = new FrameStream(conn, function(buffers, msg_type) {
        if (msg_type === ICE_FRAME_STUN_MSG_TYPE) {
            const stun_buffer = buffer_utils.join(buffers);
            if (!ice) {
                ice = ice_lookup(stun_buffer, info);
                if (!ice) {
                    destroy_conn(new Error('ICE LOOKUP FAILED'));
                    return;
                }
                // remember to close this connection when ICE closes
                ice.on('close', destroy_conn);
            }
            ice._handle_stun_packet(stun_buffer, info);
            return;
        }
        if (!temp_queue) {
            conn.emit('message', buffers);
            return;
        }
        // limit tcp that receives non-stun messages before
        // proper connection is established and the 'message' listener is added
        if (temp_queue.length > 30) {
            destroy_conn(new Error('ICE TCP TOO MANY QUEUED MESSAGES'));
            return;
        }
        temp_queue.push(buffers);
        dbg.log1('ICE TCP HOLDING MESSAGE IN QUEUE FOR LISTENER',
            temp_queue.length, info.key);
    }, ICE_FRAME_CONFIG);
}


/**
 * _find_session_to_activate
 */
Ice.prototype._find_session_to_activate = function(force) {
    var self = this;
    if (self.closed) return;

    // only the controlling chooses sessions to activate
    if (!self.controlling) return;

    var best_session;
    var highest_non_closed_priority = -Infinity;

    // find best session and see if there's any pending sessions with higher priority
    _.each(self.sessions_by_tid, function(session) {
        if (session.is_closed()) return;
        if (session.remote.priority > highest_non_closed_priority) {
            highest_non_closed_priority = session.remote.priority;
        }
        if (!session.is_ready()) return;
        if (best_session) {
            // in case of priority tie, we pick in arbitrary way to break tie
            // so here we compare key lexical order
            if (session.remote.priority === best_session.remote.priority) {
                if (session.key > best_session.key) {
                    best_session = session;
                }
            } else if (session.remote.priority > best_session.remote.priority) {
                best_session = session;
            }
        } else {
            best_session = session;
        }
    });

    if (best_session &&
        (force || highest_non_closed_priority <= best_session.remote.priority)) {
        self._activate_session(best_session);
    }
};


/**
 * _activate_session
 */
Ice.prototype._activate_session = function(session) {
    if (this.closed) return;
    if (this.activating_session) return;
    this.activating_session = session;

    dbg.log3('ICE SESSION ACTIVATING', session.key);

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
        session.tcp.frame_stream.send_message([session.packet], ICE_FRAME_STUN_MSG_TYPE);
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
    dbg.log3('ICE SESSION ACTIVE', session.key);
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
    if (session.tcp && self.config.tcp_tls) {
        // submit the upgrade to allow the stun response to be sent
        // before tls kicks in so that the peer will also get it plain
        setImmediate(function() {
            self._upgrade_to_tls(session);
        });
    } else {
        self.emit('connect', session);
    }
};


Ice.prototype._upgrade_to_tls = function(session) {
    var self = this;
    dbg.log1('ICE UPGRADE TO TLS', session.key, session.state);
    var tcp_conn = session.tcp;
    var tls_conn;
    var ssl_options = { honorCipherOrder: true, ...self.config.ssl_options };
    if (self.controlling) {
        ssl_options.socket = tcp_conn;
        tls_conn = tls.connect(ssl_options);
    } else {
        ssl_options.isServer = true;
        tls_conn = new tls.TLSSocket(tcp_conn, ssl_options);
    }
    // for some reason the expected event 'secureConnect' is only emitted
    // on the connect side and not on the server side, so using the 'secure'
    // event from SecurePair works well:
    // https://nodejs.org/api/tls.html#tls_event_secure
    tls_conn.on('secure', once_connected);
    tls_conn.on('error', destroy_conn);
    tls_conn.on('close', destroy_conn);

    function destroy_conn(err) {
        if (err) {
            dbg.log0('TLS ERROR:', session.key, err);
        } else {
            dbg.log0('TLS CLOSED:', session.key);
        }
        session.close(err);
    }

    function once_connected() {
        dbg.log3('ICE TLS CONNECTED', session.key, tls_conn.getCipher());
        session.tcp = tls_conn;
        tls_conn.frame_stream = new FrameStream(tls_conn);
        self.emit('connect', session);
    }
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

    dbg.log3('ICE STUN REQUEST FROM', info.key);

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
    }
    if (info.session) {
        if (info.tcp && !info.tcp.destroyed &&
            (!info.session.tcp || info.session.tcp.destroyed)) {
            info.session.tcp = info.tcp;
        }
        if (info.session.mark_ready()) {
            dbg.log3('ICE SESSION READY (REQUESTED)', info.session.key, this.connid);
            this._find_session_to_activate();
        }
        if (attr_map.use_candidate) {
            this._activate_session_complete(info.session);
        }
    }

    // send stun response
    var reply = this._make_stun_request_response(info, buffer, attr_map.use_candidate);
    if (info.tcp) {
        info.tcp.frame_stream.send_message([reply], ICE_FRAME_STUN_MSG_TYPE);
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
        dbg.log3('ICE STUN RESPONSE FROM SERVER', info.key);
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

    dbg.log3('ICE STUN RESPONSE FROM PEER', info.key);

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
        dbg.log3('ICE SESSION READY (RESPONDED)', session.key, this.connid);
        changed = true;
    }
    if (session.mark_ready()) {
        dbg.log3('ICE SESSION READY (RESPONDED)', session.key, this.connid);
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
    return P.map(self.config.stun_servers, function(stun_url) {
        if (!stun_url) return;
        stun_url = _.isString(stun_url) ? url_utils.quick_parse(stun_url) : stun_url;
        // this request is to public server and we need to know that
        // when processing the response to not require it to include credentials,
        // while the peer stun messages will be required to include it.
        var session;
        var family = net.isIPv6(stun_url.hostname) ? 'IPv6' : 'IPv4';
        do {
            // create "minimal candidates" local and remote
            session = new IceSession(
                new IceCandidate({
                    transport: 'udp',
                    family: family,
                    address: '0.0.0.0',
                    port: self.udp.port
                }),
                new IceCandidate({
                    transport: 'udp',
                    family: family,
                    address: stun_url.hostname,
                    port: stun_url.port
                }),
                stun.new_packet(stun.METHODS.REQUEST),
                self.udp);
        } while (self.stun_server_sessions_by_tid[session.tid]);
        self.stun_server_sessions_by_tid[session.tid] = session;
        // send udp requests until replied
        session.mark_checking();
        session.run_udp_request_loop();
        // the stun response will add the local candidate and wake us up
        return session.wait_for().then(function() {
            session.run_udp_indication_loop();
        });
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
        (ip_module.isPrivate(cand.address) ? 1000 : 0) +
        (cand.transport === 'tcp' ? 100 : 0) +
        // (cand.family === 'IPv4' ? 10 : 0) +
        (cand.tcp_type === CAND_TCP_TYPE_SO ? 0 : 1);
    return cand;
}

util.inherits(IceSession, events.EventEmitter);

function IceSession(local, remote, packet, udp) {
    var self = this;
    events.EventEmitter.call(self);
    self.local = local;
    self.remote = remote;
    self.packet = packet;
    self.udp = udp;
    self.key = make_session_key(local, remote);
    self.tid = stun.get_tid_field(self.packet).toString('base64');
    self.state = 'init';
    js_utils.self_bind(self, 'run_udp_request_loop');
    js_utils.self_bind(self, 'run_udp_indication_loop');
    self.defer = new P.Defer();
    self.defer.promise.catch(_.noop); // to ignore 'Unhandled rejection' printouts
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
    dbg.log3('ICE UDP SEND', this.key);
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


/**
 *
 * listen_on_port_range
 *
 * start a tcp listening server on port (random or in range),
 * and return the listening server, or reject if failed.
 * @param port_range - port number or object with integers min,max
 */
function listen_on_port_range(port_range) {
    var attempts = 0;
    var max_attempts = 3;
    return P.fcall(try_to_listen);

    function try_to_listen() {
        var port;
        var server = net.createServer();
        if (typeof(port_range) === 'object') {
            if (typeof(port_range.min) === 'number' &&
                typeof(port_range.max) === 'number') {
                max_attempts = Math.min(10, 10 * (port_range.max - port_range.min));
                port = chance.integer(port_range);
            } else {
                port = port_range.port || 0;
            }
        } else if (typeof(port_range) === 'number') {
            port = port_range;
        } else {
            // can't use port 0 to allocate random port because
            // when running inside a nodejs 'cluster' then it will
            // allocate the same port for all listen(0) calls.
            port = chance.integer({
                min: 1025,
                max: 64 * 1024,
            });
        }
        if (attempts > max_attempts) {
            throw new Error('ICE PORT ALLOCATION EXHAUSTED');
        }
        dbg.log3('ICE listen_on_port_range', port, 'attempts', attempts);
        attempts += 1;
        server.listen(port);
        // wait for listen even, while also watching for error/close.
        return events.once(server, 'listening')
            .then(() => server)
            .catch(function(err) {
                dbg.log1('ICE listen_on_port_range: FAILED', port, err);
                server.close();
                return P.delay(1).then(try_to_listen);
            });
    }
}

/**
 *
 * allocate_port_in_range
 *
 * try to allocate a port (random or in range),
 * and in any case release it and return it's number.
 * @param port_range - port number or object with integers min,max
 */
function allocate_port_in_range(port_range) {
    return listen_on_port_range(port_range)
        .then(function(server) {
            var port = server.address().port;
            server.close();
            return port;
        });
}
