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

const SESSION_QUERY_PARAM = 'n2n_session_id';
// Dummy base for new URL() when req.url is path+query only (e.g. /?n2n_session_id=...)
const REQ_URL_PARSE_BASE = 'wss://n2n.local';

/**
 * Collect local/public addresses this agent may offer for N2N dial
 * (interfaces, public_ips, optional loopback fallback)
 * @param {object} n2n_config
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
 * The dialer tries these endpoints in priority order until one connects.
 * @param {object} n2n_config
 * @returns {string[]}
 */
function gather_wss_endpoints(n2n_config) {
    const port = n2n_config.wss_port;
    if (!port) return [];

    const endpoints = collect_offer_addresses(n2n_config).map(address =>
        url_utils.construct_url({
            protocol: 'wss',
            hostname: address,
            port,
        }).href
    );
    return sort_endpoints(endpoints);
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
 * Sort endpoints preferring private IPs (same idea as ICE candidate priority)
 * @param {string[]} endpoints
 * @returns {string[]}
 */
function sort_endpoints(endpoints) {
    return endpoints.slice().sort((a, b) => endpoint_priority(b) - endpoint_priority(a));
}

/**
 * Higher score is tried first
 * @param {string} endpoint
 * @returns {number}
 */
function endpoint_priority(endpoint) {
    try {
        return net_utils.is_private(hostname_from_endpoint(endpoint)) ? 1000 : 0;
    } catch (err) {
        return 0;
    }
}

/**
 * Filter remote endpoints by accept_ipv4 / accept_ipv6
 * @param {string[]} endpoints
 * @param {object} n2n_config
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
 * Append n2n_session_id query param to a wss endpoint
 * @param {string} endpoint
 * @param {string} session_id
 * @returns {string}
 */
function endpoint_with_session(endpoint, session_id) {
    const endpoint_url = new URL(endpoint);
    endpoint_url.searchParams.set(SESSION_QUERY_PARAM, session_id);
    return endpoint_url.href;
}

/**
 * Parse n2n_session_id from an inbound HTTP upgrade request URL
 * @param {string} req_url
 * @returns {string|undefined}
 */
function parse_session_id_from_req_url(req_url) {
    try {
        const req_url_parsed = new URL(req_url, REQ_URL_PARSE_BASE);
        return req_url_parsed.searchParams.get(SESSION_QUERY_PARAM) || undefined;
    } catch (err) {
        return undefined;
    }
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
    ws.on('error', err => n2n_conn.emit('error', err));
    ws.on('close', () => n2n_conn.emit('error', stackless_error('N2N WSS CLOSED')));
    ws.on('message', fragments => n2n_conn.emit('message', fragments));
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
 * Dialer side: open one outbound WSS connection and bind it to the RpcN2NConnection.
 * Fails fast on handshakeTimeout so later endpoints can still be tried.
 * Does not bind if the RPC connection closed while the dial was pending.
 * @param {import('./rpc_n2n')} n2n_conn
 * @param {string} wss_url
 * @returns {Promise<void>}
 */
async function dial_wss(n2n_conn, wss_url) {
    const ws = new WS(wss_url, [], {
        // Same as ICE n2n_config.ssl_options.rejectUnauthorized: false —
        // agents use self-signed certs, so peer TLS must not be verified.
        rejectUnauthorized: false,
        perMessageDeflate: false,
        handshakeTimeout: config.N2N_WSS_DIAL_TIMEOUT_MS,
    });
    try {
        await once(ws, 'open');
    } catch (err) {
        try {
            ws.terminate();
        } catch (terminate_err) {
            // ignore terminate errors on failed dial
        }
        throw err;
    }
    if (n2n_conn.is_closed()) {
        ws.terminate();
        throw stackless_error('N2N WSS CONNECTION CLOSED DURING DIAL');
    }
    bind_ws(n2n_conn, ws);
    n2n_conn.emit('connect');
}

/**
 * Dial remote endpoints in priority order until one connects.
 * Stops if the RPC connection closed (e.g. RPC_CONNECT_TIMEOUT) during earlier tries.
 * @param {import('./rpc_n2n')} n2n_conn
 * @param {{ session_id?: string, endpoints?: string[] }} remote_info
 * @returns {Promise<void>}
 */
async function dial_remote_endpoints(n2n_conn, remote_info) {
    const session_id = remote_info && remote_info.session_id;
    if (!session_id) throw new Error('N2N WSS MISSING REMOTE SESSION ID');

    const endpoints = sort_endpoints(
        filter_acceptable_endpoints(remote_info.endpoints || [], n2n_conn.n2n_agent.n2n_config)
    );
    if (!endpoints.length) throw new Error('N2N WSS NO REMOTE ENDPOINTS');

    let last_err;
    for (const endpoint of endpoints) {
        if (n2n_conn.is_closed()) break;
        try {
            dbg.log1('N2N WSS TRY', 'session', session_id, endpoint, n2n_conn.connid);
            await dial_wss(n2n_conn, endpoint_with_session(endpoint, session_id));
            dbg.log0('N2N WSS CONNECTED', endpoint, n2n_conn.connid);
            return;
        } catch (err) {
            dbg.warn('N2N WSS TRY FAILED', endpoint, err.message || err);
            last_err = err;
        }
    }
    throw last_err || new Error('N2N WSS CONNECT FAILED');
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
    dbg.log1('N2N WSS CONNECT REMOTE', 'session', remote_info && remote_info.session_id,
        'endpoints', remote_info && remote_info.endpoints, n2n_conn.connid);
    await dial_remote_endpoints(n2n_conn, remote_info);
}

/**
 * Acceptor side: wait for WSS listen, register pending session, return local endpoints.
 * Dialer signal payload is unused. Auth uses only the session_id returned here.
 * @param {import('./rpc_n2n')} n2n_conn
 * @param {object} [remote_info] dialer offer from signaller (ignored for WSS)
 * @returns {Promise<{ session_id: string, endpoints: string[] }>}
 */
async function accept(n2n_conn, remote_info) {
    // Agent starts listen without awaiting; wait here so we do not advertise a dead port
    await n2n_conn.n2n_agent.ensure_wss_listening();
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
    dbg.log1('N2N WSS ACCEPT', 'session', session_id,
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
 * wipe the error stack
 * (copied from rpc_wss)
 * @param {string | undefined} msg
 */
function stackless_error(msg) {
    const err = new Error(msg);
    err.stack = '';
    return err;
}

exports.SESSION_QUERY_PARAM = SESSION_QUERY_PARAM;
exports.gather_wss_endpoints = gather_wss_endpoints;
exports.parse_session_id_from_req_url = parse_session_id_from_req_url;
exports.bind_ws = bind_ws;
exports.connect = connect;
exports.accept = accept;
exports.close = close;
