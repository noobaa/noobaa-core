/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {import('./rpc_base_conn')} RpcBaseConnection */
/** @typedef {import('./rpc_schema')} RpcSchema */

const _ = require('lodash');
const util = require('util');
const assert = require('assert');
// const ip_module = require('ip');
const EventEmitter = require('events').EventEmitter;

const P = require('../util/promise');
const js_utils = require('../util/js_utils');
const dbg = require('../util/debug_module')(__filename);
const config = require('../../config');
const RpcError = require('./rpc_error');
const url_utils = require('../util/url_utils');
const RpcRequest = require('./rpc_request');
const RpcMessage = require('./rpc_message');
const RpcWsServer = require('./rpc_ws_server');
const RpcN2NAgent = require('./rpc_n2n_agent');
const RpcTcpServer = require('./rpc_tcp_server');
const RpcHttpServer = require('./rpc_http_server');
const RpcNtcpServer = require('./rpc_ntcp_server');
const RpcWsConnection = require('./rpc_ws');
const RpcTcpConnection = require('./rpc_tcp');
const RpcN2NConnection = require('./rpc_n2n');
const RpcHttpConnection = require('./rpc_http');
const RpcNudpConnection = require('./rpc_nudp');
const RpcNtcpConnection = require('./rpc_ntcp');
const RpcFcallConnection = require('./rpc_fcall');
const RPC_BUFFERS = RpcRequest.RPC_BUFFERS;

// dbg.set_module_level(5, __dirname);

/**
 *
 * RPC
 *
 */
class RPC extends EventEmitter {

    /**
     * 
     * @param {{
     *  schema?: RpcSchema,
     *  router?: object,
     *  api_routes?: object,
     * }} options 
     */
    constructor(options) {
        super();
        options = options || {};
        this._services = {};
        this._connection_by_address = new Map();
        this._address_to_url_cache = new Map();
        // public properties
        this.schema = options.schema;
        this.router = options.router;
        this.api_routes = options.api_routes;
        this._aggregated_flight_time = 0;
        this._served_requests = 0;
        this.RPC_BUFFERS = RPC_BUFFERS;
        this._routing_authority = null;
        this.should_emit_request_errors = false;
        this.should_emit_stats = false;
        this.routing_hint = undefined;
    }

    /**
     *
     * new_client
     * @param {Object} [options]
     * @returns {nb.APIClient}
     *
     */
    new_client(options) {
        return this.schema ?
            this.schema.new_client(this, options) :
            null;
    }

    /**
     *
     * register_service
     *
     */
    register_service(api, server, options) {
        options = options || {};

        dbg.log0('RPC register_service', api.$id);

        _.each(api.methods, (method_api, method_name) => {
            const srv = api.$id + '.' + method_name;
            assert(!this._services[srv],
                'RPC register_service: service already registered ' + srv);
            const func = server[method_name] ||
                (options.allow_missing_methods && (() => P.reject({
                    data: 'RPC register_service:' +
                        ' missing method implementation - ' +
                        method_api.fullname
                })));
            assert.strictEqual(typeof(func), 'function',
                'RPC register_service: server method should be a function - ' +
                method_api.fullname + '. Is of type ' + typeof(func));

            this._services[srv] = {
                api: api,
                server: server,
                options: options,
                method_api: method_api,
                server_func: (...args) => func.apply(server, args)
            };
        });


        //Service was registered, call _init (if exists)
        if (server._init) {
            dbg.log2('RPC register_service: calling _init() for', api.$id);
            server._init();
        }
    }

    replace_service(api, server, options) {
        options = options || {};

        dbg.log0('RPC replace_service', api.$id);

        _.each(api.methods, (method_api, method_name) => {
            const srv = api.$id + '.' + method_name;
            assert(this._services[srv],
                'RPC replace_service: service is not registered ' + srv);
            const func = server[method_name] ||
                (options.allow_missing_methods && (() => P.reject({
                    data: 'RPC replace_service:' +
                        ' missing method implementation - ' +
                        method_api.fullname
                })));
            assert.strictEqual(typeof(func), 'function',
                'RPC replace_service: server method should be a function - ' +
                method_api.fullname + '. Is of type ' + typeof(func));

            this._services[srv] = {
                api: api,
                server: server,
                options: options,
                method_api: method_api,
                server_func: (...args) => func.apply(server, args)
            };
        });


        //Service was registered, call _init (if exists)
        if (server._init) {
            dbg.log2('RPC replace_service: calling _init() for', api.$id);
            server._init();
        }
    }

    /**
     *
     * is_service_registered
     *
     */
    is_service_registered(api) {
        if (!this._services[api]) {
            return false;
        }
        return true;
    }

    /**
     * Make a client request
     *
     * @param {string} api
     * @param {string} method_api
     * @param {any} params
     * @param {{
     *  address?: string, // url for the request target.
     *  auth_token?: string, // token to send for request quthorization.
     *  timeout?: number, // ms to wait for send-request/wait-for-reponse to complete
     *  tracker?: (req: RpcRequest) => void,
     *  return_rpc_req?: boolean,
     * }} options
     */
    async _request(api, method_api, params, options) {
        const req = new RpcRequest();
        try {
            options = options || {};

            // initialize the request
            req._new_request(api, method_api, params, options.auth_token);
            req._response_defer = new P.Defer();
            req._response_defer.promise.catch(_.noop); // to prevent error log of unhandled rejection

            if (options.tracker) {
                options.tracker(req);
            }

            if (this._disconnected_state) {
                throw new RpcError('RPC_DISCONNECTED_STATE', 'RPC_DISCONNECTED_STATE - failing request ' + req.base_info);
            }
            if (!this._disable_validation) {
                req.method_api.validate_params(req.params, 'CLIENT');
            }

            // assign a connection to the request
            const conn = this._assign_connection(req, options);
            if (!conn) { // proxying
                return this._proxy(api, method_api, params, options);
            }

            dbg.log1('RPC._request: START', req.base_info);

            // connect the connection
            await P.timeout(options.timeout,
                req.connection.connect(),
                () => new RpcError('RPC_REQUEST_TIMEOUT', 'RPC REQUEST TIMEOUT while connecting' + req.base_info)
            );


            dbg.log1('RPC._request: SEND', req.base_info);

            if (this._request_logger) {
                this._request_logger('RPC REQUEST SEND', req.srv, params);
            }

            // send request over the connection
            await P.timeout(options.timeout,
                req.connection.send(req.make_request_message(), req),
                () => new RpcError('RPC_REQUEST_TIMEOUT', 'RPC REQUEST TIMEOUT while sending request ' + req.base_info)
            );

            dbg.log1('RPC._request: WAIT', req.base_info);

            const reply = await P.timeout(options.timeout,
                req._response_defer.promise,
                () => new RpcError('RPC_REQUEST_TIMEOUT', 'RPC REQUEST TIMEOUT while waiting for response ' + req.base_info)
            );

            if (!this._disable_validation) {
                req.method_api.validate_reply(reply, 'CLIENT');
            }

            if (this._request_logger) {
                this._request_logger('RPC REQUEST REPLY', req.srv, '==>', reply);
            }

            dbg.log1('RPC._request: DONE', req.base_info, req.took_info);

            this._update_flight_avg(req.took_flight);
            if (this.should_emit_stats) {
                this.emit('stats', this._aggregated_flight_time / this._served_requests);
            }

            // return_rpc_req mode allows callers to get back the request
            // instead of a bare reply, and the reply is in req.reply
            return options.return_rpc_req ? req : reply;

        } catch (err) {

            if (this._request_logger) {
                this._request_logger('RPC REQUEST CATCH', req.srv, '==>', err);
            }

            dbg.error('RPC._request: response ERROR',
                req.base_info,
                'params', util.inspect(params, true, null, true),
                req.took_info,
                err.stack || err
            );

            if (this.should_emit_request_errors) {
                this.emit('request_error', err);
            }

            throw err;

        } finally {
            this._release_connection(req);
        }
    }


    /**
     * @param {RpcBaseConnection} conn
     * @param {RpcMessage} msg
     */
    async _on_request(conn, msg) {
        const req = new RpcRequest();
        // const millistamp = time_utils.millistamp();
        req.connection = conn;
        req.reqid = msg.body.reqid;
        req.srv = msg.body.api + '.' + msg.body.method;

        // find the requested service
        const service = this._services[req.srv];
        if (!service) {
            dbg.warn('RPC._on_request: NO_SUCH_RPC_SERVICE', req.base_info);
            req.error = new RpcError('NO_SUCH_RPC_SERVICE', 'No such RPC Service ' + req.srv);
            req.error.stack = ''; // don't print this stack
            await this._send_response(conn, req);
            return;
        }

        try {
            // set api info to the request
            req._set_request(msg, service.api, service.method_api);

            if (this._disconnected_state) {
                throw new RpcError('RPC_DISCONNECTED_STATE', 'RPC_DISCONNECTED_STATE - failing request ' + req.base_info);
            }
            if (!this._disable_validation) {
                req.method_api.validate_params(req.params, 'SERVER');
            }

            dbg.log3('RPC._on_request: ENTER', req.base_info);

            // call service middlewares if provided
            if (service.options.middleware) {
                for (const middleware of service.options.middleware) {
                    await middleware(req);
                }
            }

            // if this request id was already received
            // (network retry? not sure we need this much today but prefer to keep for now)
            const prev_req = conn._received_requests.get(req.reqid);
            if (prev_req) {
                // in this case use the same promise to return the same reply/error
                // and avoid calling the server func again for the same request.
                req._server_promise = prev_req._server_promise;
            } else {
                // insert to requests map and call the server func
                conn._received_requests.set(req.reqid, req);
                req._server_promise = (async () => {
                    try {
                        // must keep this await inside here otherwise finally block will not apply
                        return await service.server_func(req);
                    } finally {
                        // FUTURE TODO keep received requests for some time after with LRU?
                        conn._received_requests.delete(req.reqid);
                    }
                })();
            }

            req.reply = await req._server_promise;

            if (!this._disable_validation) {
                req.method_api.validate_reply(req.reply, 'SERVER');
            }

            dbg.log3('RPC._on_request: COMPLETED', req.base_info);
            await this._send_response(conn, req);

        } catch (err) {
            console.error('RPC._on_request: ERROR', req.base_info, err.stack || err);
            // propagate rpc errors from inner rpc client calls (using err.rpc_code)
            // set default internal error if no other error was specified
            if (err instanceof RpcError) {
                req.error = err;
            } else {
                req.error = new RpcError(err.rpc_code || 'INTERNAL', err.message, { retryable: true });
                req.error.stack = ''; // don't print this stack
            }
            await this._send_response(conn, req);
        }
    }

    /**
     * @param {RpcBaseConnection} conn
     * @param {RpcRequest} req
     */
    async _send_response(conn, req) {
        try {
            await conn.send(req.make_response_message(), req);
        } catch (err) {
            const desc = `srv ${req.srv} reqid ${req.reqid} connid ${conn.connid}`;
            console.error('RPC._on_request: send response message ERROR', desc, err.stack || err);
        }
    }

    /**
     *
     * _on_response
     * @param {RpcBaseConnection} conn
     * @param {RpcMessage} msg
     */
    _on_response(conn, msg) {
        dbg.log1('RPC._on_response:',
            'reqid', msg.body.reqid,
            'connid', conn.connid);

        const req = conn._sent_requests.get(msg.body.reqid);
        if (!req) {
            dbg.warn('RPC._on_response: GOT RESPONSE BUT NO REQUEST',
                'reqid', msg.body.reqid,
                'connid', conn.connid);
            return;
        }

        const is_pending = req._set_response(msg);
        if (!is_pending) {
            dbg.warn('RPC._on_response: GOT RESPONSE BUT REQUEST NOT PENDING',
                'reqid', msg.body.reqid,
                'connid', conn.connid);
        }
    }


    /**
     * @param {RpcRequest} req 
     */
    _get_remote_address(req, options) {
        var address = options.address;
        if (!address) {
            const domain = options.domain || this.api_routes[req.api.$id] || 'default';
            address = this.router[domain];
            dbg.log3('RPC ROUTER', domain, '=>', address);
        }
        assert(address, 'No RPC Address/Domain');
        address = address.toLowerCase();
        var addr_url = this._address_to_url_cache.get(address);
        if (!addr_url) {
            addr_url = url_utils.quick_parse(address, true);
            this._address_to_url_cache.set(address, addr_url);
        }
        return addr_url;
    }

    /**
     * @param {RpcRequest} req
     * @returns {RpcBaseConnection}
     */
    _assign_connection(req, options) {
        var conn = options.connection;
        if (!conn) {
            const addr_url = this._get_remote_address(req, options);
            conn = this._get_connection(addr_url, req.srv);
        }
        if (conn) {
            if (options.connect_timeout) conn._connect_timeout_ms = options.connect_timeout;
            req.connection = conn;
            req.reqid = conn._alloc_reqid();
            conn._sent_requests.set(req.reqid, req);
        }
        return conn;
    }

    /**
     *
     * _release_connection
     *
     * @param {RpcRequest} req
     */
    _release_connection(req) {
        if (req.connection) {
            req.connection._sent_requests.delete(req.reqid);
        }
    }


    /**
     * @returns {RpcBaseConnection}
     */
    _get_connection(addr_url, srv) {
        var conn = this._connection_by_address.get(addr_url.href);

        if (conn) {
            if (conn.is_closed()) {
                dbg.log0('RPC _get_connection: remove stale connection',
                    'address', addr_url.href,
                    'srv', srv,
                    'connid', conn.connid);
                this._connection_by_address.delete(addr_url.href);
                conn = null;
            } else {
                dbg.log2('RPC _get_connection: existing',
                    'address', addr_url.href,
                    'srv', srv,
                    'connid', conn.connid);
            }
        }

        if (!conn) {
            if (this.n2n_proxy &&
                !this.n2n_agent &&
                addr_url.protocol === 'n2n:') {
                dbg.log2('RPC N2N PROXY',
                    'address', addr_url.href,
                    'srv', srv);
                return null;
            }
            conn = this._new_connection(addr_url);
            dbg.log2('RPC _get_connection: new',
                'address', addr_url.href,
                'srv', srv,
                'connid', conn.connid);
        }

        return conn;
    }

    /**
     * @returns {RpcBaseConnection}
     */
    _new_connection(addr_url) {
        dbg.log1('RPC _new_connection:', addr_url);
        var conn;
        switch (addr_url.protocol) {
            // order protocols by popularity
            case 'n2n:': {
                conn = new RpcN2NConnection(addr_url, this.n2n_agent);
                break;
            }
            case 'ws:':
            case 'wss:': {
                conn = new RpcWsConnection(addr_url);
                break;
            }
            case 'fcall:': {
                conn = new RpcFcallConnection(addr_url);
                break;
            }
            case 'tls:':
            case 'tcp:': {
                conn = new RpcTcpConnection(addr_url);
                break;
            }
            case 'http:':
            case 'https:': {
                conn = new RpcHttpConnection(addr_url);
                break;
            }
            case 'nudp:': {
                conn = new RpcNudpConnection(addr_url);
                break;
            }
            case 'ntcp:':
            case 'ntls:': {
                conn = new RpcNtcpConnection(addr_url);
                break;
            }
            default: {
                throw new Error('RPC new_connection: bad protocol ' + addr_url.href);
            }
        }

        this._accept_new_connection(conn);
        return conn;
    }

    /**
     * @param {RpcBaseConnection} conn
     */
    _accept_new_connection(conn) {
        if (this._disconnected_state) {
            conn.close(new RpcError('RPC_DISCONNECTED_STATE', 'RPC IN DISCONNECTED STATE - rejecting connection ' + conn.connid));
            return;
        }
        conn._sent_requests = new Map();
        conn._received_requests = new Map();
        conn.once('connect', () => {
            if (this.routing_hint) {
                dbg.log0('RPC ROUTING REQ SEND', this.routing_hint, conn.connid, conn.url.href);
                conn.send(new RpcMessage({
                    op: 'routing_req',
                    reqid: conn._alloc_reqid(),
                    routing_hint: this.routing_hint,
                }));
            }
        });
        conn.on('decoded_message', msg => this._on_message(conn, msg));
        conn.on('close', err => this._connection_closed(conn, err));
        // we let the connection handle it's own errors and decide if to close or not

        if (!conn.transient) {
            // always replace previous connection in the address map,
            // assuming the new connection is preferred.
            dbg.log3('RPC NEW CONNECTION', conn.connid, conn.url.href);
            this._connection_by_address.set(conn.url.href, conn);

            // send pings to keepalive
            conn._ping_interval = setInterval(() => {
                dbg.log4('RPC PING', conn.connid);
                const reqid = conn._alloc_reqid();
                conn._ping_reqid_set = conn._ping_reqid_set || new Set();
                conn._ping_reqid_set.add(reqid);
                // TODO instead of setting the ping exhausted count so high we better start pings only once connected
                if (conn._ping_reqid_set.size > config.RPC_PING_EXHAUSTED_COUNT) {
                    const err = new Error(`RPC PINGPONG EXHAUSTED pings ${
                    Array.from(conn._ping_reqid_set).join(',')
                } connid ${conn.connid}`);
                    dbg.warn(err);
                    conn.emit('error', err);
                    return null;
                }
                P.resolve()
                    .then(() => conn.send(new RpcMessage({
                        op: 'ping',
                        reqid: reqid
                    })))
                    .catch(_.noop); // already means the conn is closed
                return null;
            }, config.RPC_PING_INTERVAL_MS);
        }
    }


    /**
     *
     */
    _reconnect(addr_url, reconn_backoff) {
        // use the previous backoff for delay
        reconn_backoff = reconn_backoff || config.RECONN_BACKOFF_BASE;

        const conn = this._get_connection(addr_url, 'called from reconnect');
        // increase the backoff for the new connection,
        // so that if it closes the backoff will keep increasing up to max.
        if (conn._reconnect_timeout) return;
        conn._reconn_backoff = Math.min(
            reconn_backoff * config.RECONN_BACKOFF_FACTOR, config.RECONN_BACKOFF_MAX);
        conn._reconnect_timeout = setTimeout(() => {
            conn._reconnect_timeout = undefined;
            const conn2 = this._get_connection(addr_url, 'called from reconnect2');
            if (conn2 !== conn) return;
            P.resolve()
                .then(() => conn.connect())
                .then(() => {
                    // remove the backoff once connected
                    conn._reconn_backoff = undefined;
                    dbg.log1('RPC RECONNECTED', addr_url.href,
                        'reconn_backoff', reconn_backoff.toFixed(0));
                    this._aggregated_flight_time = 0;
                    this._served_requests = 0;
                    this.emit('reconnect', conn);
                })
                .catch(err => {
                    // since the new connection should already listen for close events,
                    // then this path will be called again from there,
                    // so no need to loop and retry from here.
                    dbg.warn('RPC RECONNECT FAILED', addr_url.href,
                        'reconn_backoff', reconn_backoff.toFixed(0), err.message);
                });
        }, reconn_backoff);
        if (conn._reconnect_timeout.unref) conn._reconnect_timeout.unref();
    }


    /**
     * @param {boolean} state
     */
    set_disconnected_state(state) {
        if (state) {
            this._disconnected_state = true;
            this.disconnect_all();
        } else {
            this._disconnected_state = false;
        }
    }


    /**
     *
     */
    disconnect_all() {
        for (const conn of this._connection_by_address.values()) {
            // stop reconnect from picking up immediately
            conn._no_reconnect = true;
            conn.close();
        }
    }


    /**
     * @param {RpcBaseConnection} conn
     * @param {Error} [err]
     */
    _connection_closed(conn, err) {
        dbg.log3('RPC _connection_closed:', conn.connid);

        // remove from connection pool
        if (!conn.transient && this._connection_by_address.get(conn.url.href) === conn) {
            this._connection_by_address.delete(conn.url.href);
        }

        // reject pending requests
        for (const req of conn._sent_requests.values()) {
            req.error = new RpcError('DISCONNECTED', 'connection closed ' + conn.connid + ' reqid ' + req.reqid, { retryable: true });
            req.error.stack = ''; // don't print this stack
            req._response_defer.reject(req.error);
        }

        if (conn._ping_interval) {
            clearInterval(conn._ping_interval);
            conn._ping_interval = null;
        }

        // clear the reconnect timeout if was set before on this connection
        // to handle the actual reconnect we make a new connection object
        clearTimeout(conn._reconnect_timeout);
        conn._reconnect_timeout = undefined;

        // using _.startsWith() since in some cases url.parse will add a trailing /
        // specifically in http urls for some strange reason...
        if (!conn._no_reconnect &&
            _.startsWith(conn.url.href, this.router.default)) {
            this._reconnect(conn.url, conn._reconn_backoff);
        }
    }


    /**
     * @param {RpcBaseConnection} conn
     * @param {RpcMessage} msg
     */
    _on_message(conn, msg) {
        if (!msg || !msg.body) {
            conn.emit('error', new Error('RPC._on_message: BAD MESSAGE' +
                ' typeof(msg) ' + typeof(msg) +
                ' typeof(msg.body) ' + typeof(msg && msg.body) +
                ' conn ' + conn.connid));
            return;
        }

        // provide defaults to simplify rpc http with curl
        if (!msg.body.op) msg.body.op = 'req';
        if (!msg.body.reqid) msg.body.reqid = conn._alloc_reqid();

        switch (msg.body.op) {
            case 'req': {
                P.resolve()
                    .then(() => this._on_request(conn, msg))
                    .catch(err => {
                        dbg.warn('RPC._on_message: ERROR from _on_request', err.stack || err);
                    });
                break;
            }
            case 'res': {
                this._on_response(conn, msg);
                break;
            }
            case 'routing_req': {
                dbg.log4('RPC ROUTING REQ', conn.connid, msg.body, this.router);
                const routing = this._routing_authority ? this._routing_authority(msg.body.routing_hint) : undefined;

                dbg.log0('RPC ROUTING RES SEND', routing, conn.connid, conn.url.href);
                conn.send(new RpcMessage({
                    op: 'routing_res',
                    reqid: msg.body.reqid,
                    routing,
                }));
                break;
            }
            case 'routing_res': {
                dbg.log4('RPC ROUTING RES', conn.connid, msg.body);
                if (msg.body.routing) {
                    this.router = msg.body.routing;
                }
                break;
            }
            case 'ping': {
                dbg.log4('RPC PONG', conn.connid);
                P.resolve()
                    .then(() => conn.send(new RpcMessage({
                        op: 'pong',
                        reqid: msg.body.reqid,
                    })))
                    .catch(_.noop); // already means the conn is closed
                break;
            }
            case 'pong': {
                if (conn._ping_reqid_set && conn._ping_reqid_set.has(msg.body.reqid)) {
                    dbg.log4('RPC PINGPONG', conn.connid);
                    conn._ping_reqid_set.delete(msg.body.reqid);
                } else {
                    dbg.warn(`RPC PINGPONG MISMATCH pings ${
                        Array.from(conn._ping_reqid_set).join(',')
                    } pong ${msg.body.reqid
                    } connid ${conn.connid}`);
                }
                break;
            }
            default: {
                conn.emit('error', new Error('RPC._on_message:' +
                    ' BAD MESSAGE OP ' + msg.body.op +
                    ' reqid ' + msg.body.reqid +
                    ' connid ' + conn.connid));
                break;
            }
        }
    }

    _proxy(api, method, params, options) {
        const req = {
            method_api: api.$id,
            method_name: method.name,
            target: options.address,
            request_params: js_utils.omit_symbol(params, RPC_BUFFERS),
            [RPC_BUFFERS]: params && params[RPC_BUFFERS]
        };

        return P.resolve()
            .then(() => this.n2n_proxy(req))
            .then(res => {
                if (res.proxy_reply) {
                    res.proxy_reply[RPC_BUFFERS] = res[RPC_BUFFERS];
                }
                return res.proxy_reply;
            });
    }

    _update_flight_avg(flight_time) {
        this._aggregated_flight_time += flight_time;
        this._served_requests += 1;
    }


    /**
     * start_http_server
     */
    start_http_server(options) {
        dbg.log0('RPC start_http_server', options);
        const rpc_http_server = new RpcHttpServer();
        rpc_http_server.on('connection', conn => this._accept_new_connection(conn));
        return rpc_http_server.start_server(options)
            .then(http_server => {
                if (options.protocol === 'ws:' ||
                    options.protocol === 'wss:') {
                    this.register_ws_transport(http_server);
                }
                return http_server;
            });
    }


    /**
     * register_http_app
     */
    register_http_app(express_app) {
        dbg.log0('RPC register_http_app');
        const http_server = new RpcHttpServer();
        http_server.on('connection', conn => this._accept_new_connection(conn));
        http_server.install_on_express(express_app);
        return http_server;
    }

    /**
     * register_http_transport
     */
    register_http_transport(server) {
        dbg.log0('RPC register_http_transport');
        const http_server = new RpcHttpServer();
        http_server.on('connection', conn => this._accept_new_connection(conn));
        http_server.install_on_server(server);
        return http_server;
    }


    /**
     * register_ws_transport
     */
    register_ws_transport(http_server) {
        dbg.log0('RPC register_ws_transport');
        const ws_server = new RpcWsServer(http_server);
        ws_server.on('connection', conn => this._accept_new_connection(conn));
        return ws_server;
    }


    /**
     * register_tcp_transport
     */
    async register_tcp_transport(port, tls_options) {
        dbg.log0('RPC register_tcp_transport');
        const tcp_server = new RpcTcpServer(tls_options);
        tcp_server.on('connection', conn => this._accept_new_connection(conn));
        await tcp_server.listen(port);
        return tcp_server;
    }


    /**
     * register_ntcp_transport
     */
    async register_ntcp_transport(port, tls_options) {
        dbg.log0('RPC register_ntcp_transport');
        const ntcp_server = new RpcNtcpServer(tls_options);
        ntcp_server.on('connection', conn => this._accept_new_connection(conn));
        await ntcp_server.listen(port);
        return ntcp_server;
    }


    /**
     * register_nudp_transport
     *
     * this is not really like tcp listening, it only creates a one time
     * nudp connection that binds to the given port, and waits for a peer
     * to connect. after that connection is made, it ceases to listen for new connections,
     * and that udp port is used for the nudp connection.
     */
    async register_nudp_transport(port) {
        dbg.log0('RPC register_nudp_transport');
        const conn = new RpcNudpConnection(url_utils.quick_parse('nudp://0.0.0.0:0'));
        conn.on('connect', () => this._accept_new_connection(conn));
        return conn.accept(port);
    }


    /**
     * register_n2n_agent
     */
    register_n2n_agent(send_signal_func) {
        if (this.n2n_agent) {
            console.log('RPC N2N already registered. ignoring');
            return this.n2n_agent;
        }
        dbg.log0('RPC register_n2n_agent');
        const n2n_agent = new RpcN2NAgent({
            send_signal: send_signal_func
        });
        n2n_agent.on('connection', conn => this._accept_new_connection(conn));
        this.n2n_agent = n2n_agent;
        return n2n_agent;
    }

    /**
     * this function allows the n2n protocol to accept connections.
     * it should called when a signal is accepted in order to process it by the n2n_agent.
     */
    async accept_n2n_signal(params) {
        return this.n2n_agent.accept_signal(params);
    }


    /**
     * register_n2n_proxy
     */
    register_n2n_proxy(proxy_func) {
        dbg.log0('RPC register_n2n_proxy');
        this.n2n_proxy = proxy_func;
    }

    register_routing_authority(resolve_routing_cb) {
        dbg.log0('RPC register_routing_authority');
        this._routing_authority = resolve_routing_cb;
    }

    disable_validation() {
        this._disable_validation = true;
    }

    enable_validation() {
        this._disable_validation = false;
    }

    get_request_logger() {
        return this._request_logger;
    }

    set_request_logger(request_logger) {
        this._request_logger = request_logger;
    }

}

// EXPORTS
module.exports = RPC;
