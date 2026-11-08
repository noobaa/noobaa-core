/* Copyright (C) 2016 NooBaa */
'use strict';

const os = require('os');
const net = require('net');
const crypto = require('crypto');
const { once } = require('events');
// @ts-ignore no @types/ws in this repo
const WS = require('ws');

const dbg = require('../util/debug_module')(__filename);
const config = require('../../config');
const net_utils = require('../util/net_utils');
const url_utils = require('../util/url_utils');

const SESSION_HEADER = 'n2n_session_id';

const DIAL_STATUS = Object.freeze({
    PENDING: 'pending',
    READY: 'ready',
    FAILED: 'failed',
});

/**
 * N2N config fields used by the WSS transport helpers
 * @typedef {{
 *   wss_port?: number,
 *   offer_ipv4?: boolean,
 *   offer_ipv6?: boolean,
 *   accept_ipv4?: boolean,
 *   accept_ipv6?: boolean,
 *   offer_internal?: boolean,
 *   public_ips?: string[],
 * }} N2NWssConfig
 */

/**
 * Collect local/public addresses this agent may offer for N2N dial
 * (interfaces, public_ips, optional loopback fallback)
 * @param {N2NWssConfig} n2n_config
 * @returns {string[]}
 */
function collect_offer_addresses(n2n_config) {
    /**
     * @type {string[]}
     */
    const addresses = [];
    const seen = new Set();

    /**
     * Add one address if not already present
     * @param {string} address
     */
    function add_address(address) {
        if (!address || seen.has(address)) return;
        seen.add(address);
        addresses.push(address);
    }

    let ifaces_by_name;
    try {
        ifaces_by_name = os.networkInterfaces();
    } catch (err) {
        dbg.warn('N2N WSS networkInterfaces failed', err.message || err);
        ifaces_by_name = {};
    }

    for (const [ifname, ifaces] of Object.entries(ifaces_by_name)) {
        // ignore apple internal network
        if (ifname.startsWith('awdl')) continue;
        if (!ifaces) continue;
        for (const iface of ifaces) {
            // ignore loopback candidates for now
            if (n2n_config.offer_internal === false && iface.internal) continue;
            const family = net_utils.normalize_family(iface.family);
            if (n2n_config.offer_ipv4 === false && family === 'ipv4') continue;
            if (n2n_config.offer_ipv6 === false && family === 'ipv6') continue;
            add_address(iface.address);
            // for the nodes internal ip - add public_ips as another network interface. take same parameters as internal ip
            if (iface.address === net_utils.get_local_address() &&
                n2n_config.public_ips &&
                n2n_config.public_ips.length) {
                for (const ip of n2n_config.public_ips) {
                    if (ip !== iface.address) add_address(ip);
                }
            }
        }
    }

    // fallback when interfaces are unavailable (restricted env) or only loopback is allowed
    if (!addresses.length && n2n_config.offer_internal !== false) {
        add_address('127.0.0.1');
    }

    return addresses;
}

/**
 * Build wss:// URLs for this agent's single WSS listen port.
 * One agent has one listen (wss_port) but may be reachable via several addresses.
 * @param {N2NWssConfig} n2n_config
 * @returns {string[]}
 */
function gather_wss_endpoints(n2n_config) {
    const port = n2n_config.wss_port;
    if (!port) return [];

    return collect_offer_addresses(n2n_config).map(address =>
        url_utils.construct_url({
            protocol: 'wss',
            hostname: address,
            port,
        }).href
    );
}

/**
 * Parse hostname from a wss endpoint, without IPv6 URL brackets
 * @param {string} endpoint
 * @returns {string}
 */
function hostname_from_endpoint(endpoint) {
    const { hostname } = new URL(endpoint);
    return hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
}

/**
 * Filter remote endpoints by accept_ipv4 / accept_ipv6
 * @param {string[]} endpoints
 * @param {N2NWssConfig} n2n_config
 * @returns {string[]}
 */
function filter_acceptable_endpoints(endpoints, n2n_config) {
    return endpoints.filter(endpoint => {
        try {
            const address = hostname_from_endpoint(endpoint);
            if (net.isIPv4(address) && n2n_config.accept_ipv4 === false) return false;
            if (net.isIPv6(address) && n2n_config.accept_ipv6 === false) return false;
            return true;
        } catch (err) {
            return false;
        }
    });
}

/**
 * Parse n2n_session_id from an inbound HTTP upgrade request header
 * @param {import('http').IncomingMessage | undefined} req
 * @returns {string|undefined}
 */
function parse_session_id_from_req(req) {
    if (!req || !req.headers) return undefined;
    const session_id = req.headers[SESSION_HEADER];
    if (typeof session_id === 'string' && session_id) return session_id;
    return undefined;
}

/**
 * Wire an open WebSocket onto an RpcN2NConnection for send/message/close
 * (partially copied from rpc_wss)
 * @param {import('./rpc_n2n')} n2n_conn
 * @param {*} ws
 */
function bind_ws(n2n_conn, ws) {
    n2n_conn.ws = ws;
    ws.binaryType = 'fragments';
    ws.on('error', (/** @type {Error} */ err) => n2n_conn.emit('error', err));
    ws.on('close', () => n2n_conn.emit('error', stackless_error('N2N WSS CLOSED')));
    ws.on('message', (/** @type {Buffer[]} */ fragments) => n2n_conn.emit('message', fragments));
    n2n_conn._send = async msg => send_ws_message(ws, msg);
}

/**
 * Send a fragmented binary RPC message over WebSocket
 * (copied from rpc_wss)
 * @param {*} ws
 * @param {Buffer[]} msg
 */
async function send_ws_message(ws, msg) {
    const opts = {
        fin: false,
        binary: true,
        compress: false,
    };
    for (let i = 0; i < msg.length; ++i) {
        opts.fin = (i + 1 === msg.length);
        ws.send(msg[i], opts);
    }
}

/**
 * Terminate a WebSocket, ignoring errors
 * @param {*} ws
 */
function terminate_ws(ws) {
    if (!ws) return;
    try {
        ws.terminate();
    } catch (err) {
        // ignore terminate errors on failed or losing dial
    }
}

/**
 * State for trying to open WSS to one remote endpoint candidate
 * @typedef {{
 *   endpoint: string,
 *   ws: *,
 *   status: 'pending' | 'ready' | 'failed',
 *   error?: Error,
 *   opened: Promise<void>,
 * }} DialAttempt
 */

/**
 * Wait for the dial handshake and set READY or FAILED.
 * Always fulfills (errors are stored on the attempt instead of rejecting).
 * @param {DialAttempt} attempt
 * @returns {Promise<void>}
 */
async function wait_for_dial_open(attempt) {
    try {
        await once(attempt.ws, 'open');
        attempt.status = DIAL_STATUS.READY;
    } catch (err) {
        attempt.error = /** @type {Error} */ (err);
        // Losing dials are terminated after a winner is selected, so failures are expected.
        dbg.log1('N2N WSS TRY ENDED', attempt.endpoint, attempt.error.message || attempt.error);
        attempt.status = DIAL_STATUS.FAILED;
        terminate_ws(attempt.ws);
        attempt.ws = null;
    }
}

/**
 * Start one outbound WSS dial attempt
 * @param {string} endpoint
 * @param {string} session_id
 * @param {string} [connid]
 * @returns {DialAttempt}
 */
function start_dial_attempt(endpoint, session_id, connid) {
    dbg.log1('N2N WSS TRY', 'session', session_log_id(session_id), endpoint, connid);

    const ws = new WS(endpoint, [], {
        // Same as ICE n2n_config.ssl_options.rejectUnauthorized: false —
        // agents use self-signed certs, so peer TLS must not be verified.
        rejectUnauthorized: false,
        perMessageDeflate: false,
        handshakeTimeout: config.N2N_WSS_DIAL_TIMEOUT_MS,
        headers: {
            [SESSION_HEADER]: session_id,
        },
    });
    const attempt = {
        endpoint,
        ws,
        status: DIAL_STATUS.PENDING,
    };
    const dial_attempt = /** @type {DialAttempt} */ (attempt);
    // opened resolves when status becomes READY or FAILED (never rejects)
    dial_attempt.opened = wait_for_dial_open(dial_attempt);
    return dial_attempt;
}

/**
 * Pick the first ready attempt without waiting for pending dials.
 * @param {DialAttempt[]} attempts
 * @returns {DialAttempt | undefined}
 */
function find_dial_winner(attempts) {
    return attempts.find(attempt => attempt.status === DIAL_STATUS.READY);
}

/**
 * Wait for a ready dial, then terminate the losing attempts.
 * @param {import('./rpc_n2n')} n2n_conn
 * @param {DialAttempt[]} attempts
 * @returns {Promise<DialAttempt>}
 */
async function wait_for_dial_winner(n2n_conn, attempts) {
    /** @type {DialAttempt | undefined} */
    let winner;
    try {
        for (;;) {
            if (n2n_conn.is_closed()) {
                throw stackless_error('N2N WSS CONNECTION CLOSED DURING DIAL');
            }
            winner = find_dial_winner(attempts);
            if (winner) break;
            const pending = attempts.filter(attempt => attempt.status === DIAL_STATUS.PENDING);
            if (!pending.length) {
                const failed = attempts.find(attempt => attempt.error);
                throw (failed && failed.error) || new Error('N2N WSS CONNECT FAILED');
            }
            await Promise.race(pending.map(attempt => attempt.opened));
        }
        return winner;
    } finally {
        for (const attempt of attempts) {
            if (!winner || attempt !== winner) terminate_ws(attempt.ws);
        }
    }
}

/**
 * Dial all remote endpoints concurrently.
 * Select a ready dial without waiting for pending attempts.
 * Only the winner is bound. Losers are terminated.
 *
 * All dials share one n2n_session_id. The acceptor claims the first inbound socket
 * and rejects later attempts before their WebSocket handshakes complete.
 *
 * @param {import('./rpc_n2n')} n2n_conn
 * @param {{ session_id?: string, endpoints?: string[] }} remote_info
 * @returns {Promise<void>}
 */
async function dial_remote_endpoints(n2n_conn, remote_info) {
    const session_id = remote_info && remote_info.session_id;
    if (!session_id) throw new Error('N2N WSS MISSING REMOTE SESSION ID');

    const endpoints = filter_acceptable_endpoints(
        remote_info.endpoints || [], n2n_conn.n2n_agent.n2n_config
    );
    if (!endpoints.length) throw new Error('N2N WSS NO REMOTE ENDPOINTS');

    const attempts = endpoints.map(endpoint =>
        start_dial_attempt(endpoint, session_id, n2n_conn.connid)
    );
    const winner = await wait_for_dial_winner(n2n_conn, attempts);

    bind_ws(n2n_conn, winner.ws);
    n2n_conn.emit('connect');
    dbg.log0('N2N WSS CONNECTED', winner.endpoint, n2n_conn.connid);
}

/**
 * Validate dialer-side signaller reply is WSS-shaped.
 * ICE peers return { credentials, candidates } during upgrades/rollbacks.
 * @param {object} [remote_info]
 */
function assert_wss_remote_signal(remote_info) {
    if (remote_info && (remote_info.candidates || remote_info.credentials)) {
        throw stackless_error(
            'N2N WSS PEER STILL ON ICE (upgrade/rollback mismatch)');
    }
    if (!remote_info || typeof remote_info.session_id !== 'string' || !remote_info.session_id) {
        throw stackless_error('N2N WSS INVALID REMOTE SIGNAL');
    }
    if (!Array.isArray(remote_info.endpoints)) {
        throw stackless_error('N2N WSS INVALID REMOTE SIGNAL');
    }
}

/**
 * Dialer side: signal peer then connect to a remote WSS endpoint.
 * Signal offer is empty. Only the acceptor reply (session_id + endpoints) is used for Open.
 * @param {import('./rpc_n2n')} n2n_conn
 * @returns {Promise<void>}
 */
async function connect(n2n_conn) {
    dbg.log1('N2N WSS CONNECT SIGNAL', 'target', n2n_conn.url.href, n2n_conn.connid);
    const remote_info = await n2n_conn.n2n_agent.n2n_config.signaller(
        n2n_conn.url.href,
        {}
    );
    assert_wss_remote_signal(remote_info);
    dbg.log1('N2N WSS CONNECT REMOTE', 'session', session_log_id(remote_info.session_id),
        'endpoints', remote_info.endpoints, n2n_conn.connid);
    await dial_remote_endpoints(n2n_conn, remote_info);
}

/**
 * Acceptor side: wait for WSS listen, register pending session, return local endpoints.
 * Reject legacy ICE offers. Auth uses only the session_id returned here.
 * @param {import('./rpc_n2n')} n2n_conn
 * @param {{ credentials?: object, candidates?: object }} [remote_info] dialer offer from signaller
 * @returns {Promise<{ session_id: string, endpoints: string[] }>}
 */
async function accept(n2n_conn, remote_info) {
    if (remote_info && (remote_info.credentials || remote_info.candidates)) {
        throw stackless_error(
            'N2N WSS PEER STILL ON ICE (mismatch)');
    }
    // Listen was started in the background; await so we don't tell the peer a port that isn't ready yet
    await n2n_conn.n2n_agent.ensure_wss_listening();
    if (n2n_conn.is_closed()) {
        throw stackless_error('N2N WSS CONNECTION CLOSED DURING ACCEPT');
    }

    const session_id = crypto.randomBytes(16).toString('hex');
    n2n_conn.n2n_agent.register_pending_session(session_id, n2n_conn);
    const local_info = {
        session_id,
        endpoints: gather_wss_endpoints(n2n_conn.n2n_agent.n2n_config),
    };
    if (!local_info.endpoints.length) {
        n2n_conn.n2n_agent.unregister_pending_session_for_conn(n2n_conn);
        throw new Error('N2N WSS NO LOCAL ENDPOINTS');
    }
    dbg.log1('N2N WSS ACCEPT', 'session', session_log_id(session_id),
        'endpoints', local_info.endpoints,
        n2n_conn.connid);
    return local_info;
}

/**
 * Close the underlying WebSocket if open
 * (copied from rpc_wss)
 * @param {import('./rpc_n2n')} n2n_conn
 */
function close(n2n_conn) {
    const ws = n2n_conn.ws;
    if (ws &&
        ws.readyState !== WS.CLOSED &&
        ws.readyState !== WS.CLOSING) {
        ws.close();
    }
    n2n_conn.ws = null;
}

/**
 * Format a short session prefix for log correlation without logging the full token.
 * @param {string} session_id
 * @returns {string}
 */
function session_log_id(session_id) {
    return session_id.slice(0, 8) + '…';
}

/**
 * wipe the error stack
 * (copied from rpc_wss)
 * @param {string | undefined} msg
 */
function stackless_error(msg) {
    const err = new Error(msg);
    err.stack = '';
    return err;
}

exports.SESSION_HEADER = SESSION_HEADER;
exports.gather_wss_endpoints = gather_wss_endpoints;
exports.parse_session_id_from_req = parse_session_id_from_req;
exports.bind_ws = bind_ws;
exports.connect = connect;
exports.accept = accept;
exports.close = close;
