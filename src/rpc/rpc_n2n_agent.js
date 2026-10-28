/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const https = require('https');
const tls = require('tls');
const { once } = require('events');
// @ts-ignore no @types/ws in this repo
const WS = require('ws');

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const config = require('../../config');
const url_utils = require('../util/url_utils');
const ssl_utils = require('../util/ssl_utils');
const nb_native = require('../util/nb_native');
const EventEmitter = require('events').EventEmitter;
const RpcN2NConnection = require('./rpc_n2n');
const n2n_wss = require('./n2n_wss');

const N2N_STAR = 'n2n://*';
const N2N_CONFIG_PORT_PICK = ['min', 'max', 'port'];
const N2N_CONFIG_FIELDS_PICK = [
    'offer_ipv4',
    'offer_ipv6',
    'accept_ipv4',
    'accept_ipv6',
    'offer_internal',
    'tcp_active',
    'tcp_permanent_passive',
    'tcp_transient_passive',
    'tcp_simultaneous_open',
    'tcp_tls',
    'udp_port',
    'udp_dtls',
    'stun_servers',
    'public_ips'
];

// Match RPC connect timeout so the acceptor does not drop the pending session
// while the dialer is still trying endpoints.
const PENDING_SESSION_TIMEOUT_MS = config.RPC_CONNECT_TIMEOUT;

let global_tcp_permanent_passive;

/**
 * Process-wide shared HTTPS+WSS listen for N2N.
 * Hosted agents in one process all join the same port (avoids EADDRINUSE on AGENT_RPC_PORT).
 * @type {{
 *   port: number,
 *   https_server: import('https').Server | null,
 *   ws_server: * | null,
 *   agents: Set<RpcN2NAgent>,
 *   listen_promise: Promise<number>,
 *   resolve_listen: (port: number) => void,
 *   reject_listen: (err: Error) => void,
 * } | null}
 */
let shared_wss = null;

/**
 *
 * RpcN2NAgent
 *
 * represents an end-point for N2N connections.
 * it will be used to accept new connections initiated by remote peers,
 * and also when initiated locally to connect to a remote peer.
 *
 * Transport is WSS by default, or legacy ICE when config.ROLLBACK_TO_ICE is true.
 *
 */

class RpcN2NAgent extends EventEmitter {

    constructor(options) {
        super();
        options = options || {};

        // we expect all n2n connections to register on the agent n2n_reset event
        this.setMaxListeners(100);

        // send_signal is function(info) that sends over a signal channel
        // and delivers the info to info.target,
        // and returns back the info that was returned by the peer.
        const send_signal = options.send_signal;

        // Per-agent: session_id → connection waiting for the peer to dial (Map for lookup by id)
        this._pending_sessions = new Map();

        // lazy loading of nb_native to use Nudp (ICE path only, kept for rollback)
        const Nudp = nb_native().Nudp;

        // initialize the default config structure
        // tcp_*/udp_*/stun_* are required for ICE rollback and still synced for agent_info.
        // WSS uses wss_port (set via start_shared_wss_listen).
        this.n2n_config = {

            // ip options
            offer_ipv4: true,
            offer_ipv6: true,
            accept_ipv4: true,
            accept_ipv6: true,
            offer_internal: config.N2N_OFFER_INTERNAL,

            // tcp options (used by ICE, ignored by WSS connect)
            tcp_active: true,
            tcp_permanent_passive: {
                min: 60101, //60100 is used by the hosted agents
                max: 60600
            },
            tcp_transient_passive: false,
            tcp_simultaneous_open: false,
            tcp_tls: true,

            // udp options (used by ICE when ENABLE_N2N_UDP, ignored by WSS)
            udp_port: true,
            udp_dtls: false,

            // stun (used by ICE UDP candidates, ignored by WSS)
            // TODO stun server to use for N2N ICE
            // TODO Nudp require ip's, not hostnames, and also does not support IPv6 yet
            stun_servers: [
                // read_on_premise_stun_server()
                // 'stun://64.233.184.127:19302' // === 'stun://stun.l.google.com:19302'
            ],

            public_ips: [],

            // WSS listen port (set by start_shared_wss_listen; omitted from agent_info)
            /** @type {number|undefined} */
            wss_port: undefined,

            // ssl options - apply for both tcp-tls and udp-dtls (ICE) and agent HTTPS (WSS)
            ssl_options: {
                // we allow self generated certificates to avoid public CA signing:
                rejectUnauthorized: false,
                secureContext: tls.createSecureContext({ honorCipherOrder: true, ...ssl_utils.generate_ssl_certificate() }),
            },

            // callback to create and bind nudp socket (ICE only, unused by WSS)
            // TODO implement nudp dtls
            udp_socket: (udp_port, dtls) => {
                const nudp = new Nudp();
                return P.ninvoke(nudp, 'bind', 0, '0.0.0.0').then(port => {
                    nudp.port = port;
                    return nudp;
                });
            },

            // signaller callback
            // send connect info to the peer over a relayed signal channel
            // (WSS endpoints or ICE candidates, depending on ROLLBACK_TO_ICE).
            signaller: (target, info) => send_signal({
                source: this.rpc_address,
                target: target,
                info: info
            })
        };

        dbg.log0('N2N AGENT ROLLBACK_TO_ICE', config.ROLLBACK_TO_ICE);
    }

    /**
     * Set this agent's n2n:// RPC address
     * @param {string} rpc_address
     */
    set_rpc_address(rpc_address) {
        dbg.log('set_rpc_address:', rpc_address, 'was', this.rpc_address);
        this.rpc_address = rpc_address;
    }

    /**
     * Clear the RPC address
     */
    reset_rpc_address() {
        this.set_rpc_address('');
    }

    /**
     * Accept signals for any n2n target (testing / local agent)
     */
    set_any_rpc_address() {
        this.set_rpc_address(N2N_STAR);
    }

    /**
     * Update SSL secure context params (certificate) on the n2n config
     * @param {object} secure_context_params
     */
    set_ssl_context(secure_context_params) {
        this.n2n_config.ssl_options.secureContext =
            tls.createSecureContext({ ...secure_context_params, honorCipherOrder: true });
    }

    /**
     * Apply n2n_config updates from the system.
     * ICE mode may restart the TCP permanent passive listener when the port range changes.
     * Skips local wss_port so the listen port is not overwritten.
     * @param {object} n2n_config
     */
    update_n2n_config(n2n_config) {
        dbg.log0('UPDATE N2N CONFIG', n2n_config);
        _.each(n2n_config, (val, key) => {
            if (key === 'wss_port') return;
            if (config.ROLLBACK_TO_ICE && key === 'tcp_permanent_passive') {
                // since the tcp permanent object holds more info than just the port_range
                // then we need to check if the port range cofig changes, if not we ignore
                // if it did then we have to start a new
                const conf = _.pick(this.n2n_config.tcp_permanent_passive, N2N_CONFIG_PORT_PICK);
                dbg.log0('update_n2n_config: update tcp_permanent_passive old', conf, 'new', val);
                if (!_.isEqual(conf, val)) {
                    this.disconnect();
                    if (!global_tcp_permanent_passive) {
                        global_tcp_permanent_passive = _.clone(val);
                    }
                    this.n2n_config.tcp_permanent_passive = global_tcp_permanent_passive;
                }
            } else {
                this.n2n_config[key] = val;
            }
        });

        // emit 'reset_n2n' to notify all existing connections to close
        this.emit('reset_n2n');
        const remaining_listeners = this.listenerCount('reset_n2n');
        if (remaining_listeners) {
            dbg.warn('update_n2n_config: remaining listeners on reset_n2n event',
                remaining_listeners, '(probably a connection that forgot to call close)');
        }
    }

    /**
     * Stop the active N2N listen: WSS server, or ICE TCP permanent passive
     */
    disconnect() {
        if (config.ROLLBACK_TO_ICE) {
            const conf = this.n2n_config.tcp_permanent_passive;
            if (conf.server) {
                dbg.log0('close tcp_permanent_passive old server');
                conf.server.close();
                conf.server = null;
                global_tcp_permanent_passive = null;
            }
        } else {
            this.stop_wss_server();
        }
    }

    /**
     * Join the process-wide shared HTTPS+WSS listen on port.
     * First joiner creates the listen (with EADDRINUSE fallback in the PV-pool range).
     * Later joiners only add themselves so inbound dials can be matched by session_id.
     * Used by Agent for n2n:// so multiple hosted agents share one listen port.
     * @param {number|string} port
     * @param {import('https').ServerOptions} ssl_context
     * @param {{ on_close?: () => void }} [options]
     * @returns {Promise<number>} resolves to the bound port when listening
     */
    async start_shared_wss_listen(port, ssl_context, options) {
        this.stop_wss_server();
        const port_num = Number(port);
        this.n2n_config.wss_port = port_num;
        this._shared_wss_on_close = options && options.on_close;

        if (shared_wss) {
            return this._join_shared_wss(port_num);
        }
        return this._create_shared_wss(port_num, ssl_context);
    }

    /**
     * Register on an existing shared listen and wait until it is bound
     * @param {number} port_num
     * @returns {Promise<number>} bound port
     */
    async _join_shared_wss(port_num) {
        if (!shared_wss) {
            throw new Error('N2N WSS SHARED missing');
        }
        if (!can_join_shared_wss_port(port_num, shared_wss.port)) {
            const err = new Error(
                `N2N WSS SHARED PORT MISMATCH have ${shared_wss.port} want ${port_num}`);
            err.stack = '';
            throw err;
        }
        shared_wss.agents.add(this);
        dbg.log0('N2N WSS JOINED SHARED listen on port', shared_wss.port, 'agents', shared_wss.agents.size);
        const actual_port = await shared_wss.listen_promise;
        this.n2n_config.wss_port = actual_port;
        return actual_port;
    }

    /**
     * Create the process-wide shared listen. Publishes listen_promise before bind
     * so other agents can join and wait on the same Promise.
     * @param {number} port_num
     * @param {import('https').ServerOptions} ssl_context
     * @returns {Promise<number>} bound port
     */
    async _create_shared_wss(port_num, ssl_context) {
        const listen = make_shared_wss_listen_control();
        shared_wss = {
            port: port_num,
            https_server: null,
            ws_server: null,
            agents: new Set([this]),
            listen_promise: listen.promise,
            resolve_listen: listen.resolve,
            reject_listen: listen.reject,
        };

        try {
            const bound = await bind_shared_wss_with_port_fallback(port_num, ssl_context);
            if (!is_active_shared_wss_listen(listen.promise)) {
                // Last agent left while binding, or listen was superseded
                discard_bound_shared_wss(bound);
                return listen.promise;
            }
            return activate_shared_wss_listen(bound);
        } catch (err) {
            abort_shared_wss_create(listen.promise, listen.reject, /** @type {Error} */ (err));
            throw err;
        }
    }

    /**
     * Wait until this agent is on a shared WSS listen that has finished binding.
     * Used by accept so endpoints are not advertised before the socket is listening.
     * @returns {Promise<number>} bound port
     */
    async ensure_wss_listening() {
        if (!shared_wss || !shared_wss.agents.has(this)) {
            const err = new Error('N2N WSS NOT LISTENING');
            err.stack = '';
            throw err;
        }
        const actual_port = await shared_wss.listen_promise;
        if (!shared_wss || !shared_wss.agents.has(this)) {
            const err = new Error('N2N WSS NOT LISTENING');
            err.stack = '';
            throw err;
        }
        this.n2n_config.wss_port = actual_port;
        return actual_port;
    }

    /**
     * Leave the shared WSS listen and clear this agent's pending sessions
     */
    stop_wss_server() {
        this._leave_shared_wss();
        this._clear_pending_sessions('N2N WSS PENDING CANCELLED');
        delete this.n2n_config.wss_port;
        this._shared_wss_on_close = null;
    }

    /**
     * Remove this agent from the shared listen. Last agent closes the shared servers.
     */
    _leave_shared_wss() {
        if (!shared_wss || !shared_wss.agents.has(this)) return;
        shared_wss.agents.delete(this);
        dbg.log0('N2N WSS LEFT SHARED listen on port', shared_wss.port, 'agents', shared_wss.agents.size);
        if (shared_wss.agents.size > 0) return;

        const { https_server, ws_server, port, reject_listen } = shared_wss;
        const still_binding = !https_server;
        shared_wss = null;
        if (still_binding) {
            // Cancel in-flight bind so listen_promise does not hang
            const err = new Error('N2N WSS LISTEN CANCELLED');
            err.stack = '';
            reject_listen(err);
            dbg.log0('N2N WSS SHARED LISTEN CANCELLED on port', port);
            return;
        }
        force_close_shared_wss_servers(https_server, ws_server);
        dbg.log0('N2N WSS SHARED SERVER CLOSED on port', port);
    }

    /**
     * Abort pending accepts on this agent
     * @param {string} message
     */
    _clear_pending_sessions(message) {
        for (const [session_id, entry] of this._pending_sessions) {
            clearTimeout(entry.timer);
            const err = new Error(message);
            err.stack = '';
            entry.conn.emit('error', err);
            this._pending_sessions.delete(session_id);
        }
    }

    /**
     * Register a pending accept-side connection waiting for inbound WSS
     * @param {string} session_id
     * @param {RpcN2NConnection} conn
     */
    register_pending_session(session_id, conn) {
        this.unregister_pending_session_for_conn(conn);
        const timer = setTimeout(() => {
            const entry = this._pending_sessions.get(session_id);
            if (!entry || entry.conn !== conn) return;
            this._pending_sessions.delete(session_id);
            const err = new Error('N2N WSS ACCEPT TIMEOUT');
            err.stack = '';
            conn.emit('error', err);
        }, PENDING_SESSION_TIMEOUT_MS);
        this._pending_sessions.set(session_id, { conn, timer });
    }

    /**
     * Remove any pending session entry for this connection
     * @param {RpcN2NConnection} conn
     */
    unregister_pending_session_for_conn(conn) {
        for (const [session_id, entry] of this._pending_sessions) {
            if (entry.conn === conn) {
                clearTimeout(entry.timer);
                this._pending_sessions.delete(session_id);
            }
        }
    }

    /**
     * Claim an inbound WSS socket by session_id if this agent owns the pending accept
     * @param {string} session_id
     * @param {*} ws
     * @returns {boolean} true if claimed
     */
    _claim_wss_session(session_id, ws) {
        const entry = this._pending_sessions.get(session_id);
        if (!entry) return false;
        clearTimeout(entry.timer);
        this._pending_sessions.delete(session_id);
        const conn = entry.conn;
        try {
            dbg.log0('N2N WSS ACCEPT CONNECTION', conn.connid);
            n2n_wss.bind_ws(conn, ws);
            conn.emit('connect');
        } catch (err) {
            dbg.error('N2N WSS ACCEPT ERROR', err.stack || err);
            close_ws(ws);
            conn.emit('error', err);
        }
        return true;
    }

    /**
     * Plain n2n_config for agent_info reporting
     * @returns {object}
     */
    get_plain_n2n_config() {
        const n2n_config =
            _.pick(this.n2n_config, N2N_CONFIG_FIELDS_PICK);
        n2n_config.tcp_permanent_passive =
            n2n_config.tcp_permanent_passive ?
            _.pick(n2n_config.tcp_permanent_passive, N2N_CONFIG_PORT_PICK) :
            n2n_config.tcp_permanent_passive;
        return n2n_config;
    }

    /**
     * Handle an inbound n2n_signal: create connection and return local connect info
     * @param {object} params
     * @returns {object|Promise<object>}
     */
    accept_signal(params) {
        dbg.log1('N2N AGENT accept_signal:', params, 'my rpc_address', this.rpc_address);

        // target address is me, source is you.
        // the special case if rpc_address='n2n://*' allows testing code to accept for any target
        const source = url_utils.quick_parse(params.source);
        const target = url_utils.quick_parse(params.target);
        if (!this.rpc_address || !target ||
            (this.rpc_address !== N2N_STAR && this.rpc_address !== target.href)) {
            throw new Error('N2N MISMATCHING PEER ID ' + params.target +
                ' my rpc_address ' + this.rpc_address);
        }
        const conn = new RpcN2NConnection(source, this);
        conn.once('connect', () => this.emit('connection', conn));
        return conn.accept(params.info);
    }


}

/**
 * Create resolve/reject pair for shared listen_promise.
 * Logs failures so an unawaited reject is not an unhandled rejection.
 * @returns {{
 *   promise: Promise<number>,
 *   resolve: (port: number) => void,
 *   reject: (err: Error) => void,
 * }}
 */
function make_shared_wss_listen_control() {
    // Placeholders satisfy checkJs. The Promise executor runs synchronously
    // and replaces them before this function returns.
    const listen_ctl = {
        /** @type {(port: number) => void} */
        resolve: () => undefined,
        /** @type {(err: Error) => void} */
        reject: () => undefined,
    };
    const promise = new Promise((resolve, reject) => {
        listen_ctl.resolve = resolve;
        listen_ctl.reject = reject;
    });
    promise.catch(err => {
        dbg.error('N2N WSS SHARED LISTEN FAILED', err.stack || err);
    });
    return {
        promise,
        resolve: listen_ctl.resolve,
        reject: listen_ctl.reject,
    };
}

/**
 * True if shared_wss still refers to this in-flight listen_promise
 * @param {Promise<number>} listen_promise
 * @returns {boolean}
 */
function is_active_shared_wss_listen(listen_promise) {
    return Boolean(shared_wss && shared_wss.listen_promise === listen_promise);
}

/**
 * Close servers from a bind that is no longer the active shared listen
 * @param {{
 *   https_server: import('https').Server,
 *   ws_server: *,
 * }} bound
 */
function discard_bound_shared_wss(bound) {
    close_silent(bound.ws_server);
    close_silent(bound.https_server);
}

/**
 * Install bound servers on shared_wss and resolve joiners.
 * Caller must ensure this listen is still active.
 * @param {{
 *   https_server: import('https').Server,
 *   ws_server: *,
 *   actual_port: number,
 * }} bound
 * @returns {number} bound port
 */
function activate_shared_wss_listen(bound) {
    // Caller checked is_active_shared_wss_listen immediately before this.
    if (!shared_wss) {
        discard_bound_shared_wss(bound);
        throw stackless_error('N2N WSS SHARED LISTEN GONE');
    }
    const { https_server, ws_server, actual_port } = bound;
    shared_wss.https_server = https_server;
    shared_wss.ws_server = ws_server;
    shared_wss.port = actual_port;
    register_shared_wss_server_events(https_server, ws_server);
    for (const agent of shared_wss.agents) {
        agent.n2n_config.wss_port = actual_port;
    }
    dbg.log0('N2N WSS SHARED SERVER STARTED on port', actual_port);
    shared_wss.resolve_listen(actual_port);
    return actual_port;
}

/**
 * Clear this in-flight shared_wss create and reject waiters
 * @param {Promise<number>} listen_promise
 * @param {(err: Error) => void} reject_listen
 * @param {Error} err
 */
function abort_shared_wss_create(listen_promise, reject_listen, err) {
    const active = shared_wss;
    if (active && active.listen_promise === listen_promise) {
        const agents = [...active.agents];
        shared_wss = null;
        for (const agent of agents) {
            agent._clear_pending_sessions('N2N WSS PENDING CANCELLED');
            delete agent.n2n_config.wss_port;
        }
    }
    reject_listen(err);
}

/**
 * True if an agent requesting want_port may join the existing shared listen on have_port.
 * Allows: same port; want_port 0 (any existing listen, used in tests);
 * or both ports in AGENT_RPC_PORT_RANGE (60101-60600) so agents still share
 * one listen after EADDRINUSE moved the bound port.
 * @param {number} want_port
 * @param {number} have_port
 * @returns {boolean}
 */
function can_join_shared_wss_port(want_port, have_port) {
    if (want_port === 0) return true;
    if (want_port === have_port) return true;
    const min = config.AGENT_RPC_PORT_RANGE_MIN;
    const max = config.AGENT_RPC_PORT_RANGE_MAX;
    return want_port >= min && want_port <= max && have_port >= min && have_port <= max;
}

/**
 * Bind HTTPS+WSS on one port
 * @param {number} port
 * @param {import('https').ServerOptions} ssl_context
 * @returns {Promise<{
 *   https_server: import('https').Server,
 *   ws_server: *,
 *   actual_port: number,
 * }>}
 */
async function try_listen_shared_wss(port, ssl_context) {
    const https_server = https.createServer(ssl_context);
    const ws_server = new WS.Server({
        server: https_server,
        perMessageDeflate: false,
    });
    ws_server.on('connection', (ws, req) => on_shared_wss_connection(ws, req));
    // Prevent uncaught WS 'error' when listen fails (handled on https_server)
    ws_server.on('error', _.noop);
    try {
        const actual_port = await listen_https_port(https_server, port);
        return { https_server, ws_server, actual_port };
    } catch (err) {
        close_silent(ws_server);
        close_silent(https_server);
        throw err;
    }
}

/**
 * Bind HTTPS+WSS, trying the next port in AGENT_RPC_PORT_RANGE on EADDRINUSE.
 * Outside that range (e.g. hosted 60100) or port 0, a single attempt only.
 * @param {number} start_port
 * @param {import('https').ServerOptions} ssl_context
 * @returns {Promise<{
 *   https_server: import('https').Server,
 *   ws_server: *,
 *   actual_port: number,
 * }>}
 */
async function bind_shared_wss_with_port_fallback(start_port, ssl_context) {
    if (start_port === 0) {
        return try_listen_shared_wss(0, ssl_context);
    }
    const min = config.AGENT_RPC_PORT_RANGE_MIN;
    const max = config.AGENT_RPC_PORT_RANGE_MAX;
    if (start_port < min || start_port > max) {
        return try_listen_shared_wss(start_port, ssl_context);
    }

    let last_err;
    for (let port = start_port; port <= max; ++port) {
        try {
            return await try_listen_shared_wss(port, ssl_context);
        } catch (err) {
            last_err = err;
            if (err.code !== 'EADDRINUSE') throw err;
            dbg.warn('N2N WSS EADDRINUSE on port', port, '- trying next in range');
        }
    }
    throw last_err || stackless_error('N2N WSS PORT ALLOCATION EXHAUSTED');
}

/**
 * Listen on one port and resolve with the bound port number
 * @param {import('https').Server} https_server
 * @param {number} port
 * @returns {Promise<number>}
 */
async function listen_https_port(https_server, port) {
    https_server.listen(port);
    try {
        await once(https_server, 'listening');
    } catch (err) {
        await new Promise(resolve => https_server.close(() => resolve()));
        throw err;
    }
    const addr = https_server.address();
    return (addr && typeof addr === 'object') ? addr.port : port;
}

/**
 * Register error/close handlers that tear down shared_wss on unexpected server failure
 * @param {import('https').Server} https_server
 * @param {*} ws_server
 */
function register_shared_wss_server_events(https_server, ws_server) {
    ws_server.on('error', err => {
        dbg.error('N2N WSS SHARED SERVER ERROR', err.stack || err);
    });
    https_server.on('error', err => {
        dbg.error('N2N WSS SHARED HTTPS ERROR', err.stack || err);
        // Clear before close so joiners cannot attach to a failed listen.
        // Notify agents only after a successful listen so they schedule a restart.
        clear_shared_wss_for_server(https_server, { invoke_on_close: https_server.listening });
        https_server.close();
    });
    https_server.on('close', () => {
        // Intentional last-leave already cleared shared_wss before close
        if (!shared_wss || shared_wss.https_server !== https_server) return;
        dbg.warn('N2N WSS SHARED HTTPS CLOSED unexpectedly');
        clear_shared_wss_for_server(https_server, { invoke_on_close: true });
    });
}

/**
 * Clear shared_wss if it still points at https_server
 * @param {import('https').Server} https_server
 * @param {{ invoke_on_close: boolean }} options
 */
function clear_shared_wss_for_server(https_server, options) {
    if (!shared_wss || shared_wss.https_server !== https_server) return;
    const agents = [...shared_wss.agents];
    shared_wss = null;
    for (const agent of agents) {
        agent._clear_pending_sessions('N2N WSS PENDING CANCELLED');
        delete agent.n2n_config.wss_port;
        if (options.invoke_on_close) {
            const on_close = agent._shared_wss_on_close;
            agent._shared_wss_on_close = null;
            if (on_close) on_close();
        }
    }
}

/**
 * Demux inbound shared WSS by n2n_session_id across all joined agents
 * @param {*} ws
 * @param {import('http').IncomingMessage} req
 */
function on_shared_wss_connection(ws, req) {
    const session_id = n2n_wss.parse_session_id_from_req_url(req.url);
    if (session_id && shared_wss) {
        for (const agent of shared_wss.agents) {
            if (agent._claim_wss_session(session_id, ws)) return;
        }
    }
    dbg.warn('N2N WSS SHARED ACCEPT UNKNOWN SESSION');
    close_ws(ws);
}

/**
 * Close a WebSocket if it is still open
 * @param {*} ws
 */
function close_ws(ws) {
    if (ws &&
        ws.readyState !== WS.CLOSED &&
        ws.readyState !== WS.CLOSING) {
        ws.close();
    }
}

/**
 * Close an https or ws server, ignoring errors
 * @param {{ close?: Function } | null | undefined} server
 */
function close_silent(server) {
    if (!server || typeof server.close !== 'function') return;
    try {
        server.close();
    } catch (err) {
        dbg.warn('N2N WSS CLOSE ERROR', err.message || err);
    }
}

/**
 * Terminate WS clients and close shared servers so sockets do not keep the process alive
 * @param {import('https').Server | null | undefined} https_server
 * @param {*} ws_server
 */
function force_close_shared_wss_servers(https_server, ws_server) {
    if (ws_server) {
        try {
            for (const ws of ws_server.clients) {
                try {
                    ws.terminate();
                } catch (err) {
                    // ignore terminate errors on shutdown
                }
            }
        } catch (err) {
            dbg.warn('N2N WSS SHARED CLIENTS TERMINATE ERROR', err.message || err);
        }
        close_silent(ws_server);
    }
    if (https_server) {
        try {
            https_server.closeAllConnections();
        } catch (err) {
            dbg.warn('N2N WSS SHARED closeAllConnections ERROR', err.message || err);
        }
        close_silent(https_server);
    }
}

/**
 * Error without stack noise for expected control-flow failures
 * @param {string} message
 * @returns {Error}
 */
function stackless_error(message) {
    const err = new Error(message);
    err.stack = '';
    return err;
}

module.exports = RpcN2NAgent;
