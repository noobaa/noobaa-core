/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');
const assert = require('assert');
// const ip_module = require('ip');
const EventEmitter = require('events').EventEmitter;

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const RpcError = require('./rpc_error');
const url_utils = require('../util/url_utils');
const buffer_utils = require('../util/buffer_utils');
// const time_utils = require('../util/time_utils');
const RpcRequest = require('./rpc_request');
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

const RPC_PING_INTERVAL_MS = 20000;
const RECONN_BACKOFF_BASE = 250;
const RECONN_BACKOFF_MAX = 5000;
const RECONN_BACKOFF_FACTOR = 1.2;

// dbg.set_level(5, __dirname);

class Client {
    constructor(rpc, default_options) {
        this.rpc = rpc;
        this.options = _.create(default_options);
        _.each(rpc.schema, api => {
            if (!api || !api.id || api.id[0] === '_') return;
            var name = api.id.replace(/_api$/, '');
            if (name === 'rpc' || name === 'options') throw new Error('ILLEGAL API ID');
            this[name] = {};
            _.each(api.methods, (method_api, method_name) => {
                this[name][method_name] = (params, options) => {
                    options = _.create(this.options, options);
                    return rpc._request(api, method_api, params, options);
                };
            });
        });
    }
}

util.inherits(RPC, EventEmitter);

/**
 *
 * RPC
 *
 */
function RPC(options) {
    options = options || {};
    EventEmitter.call(this);
    this._services = {};
    this._connection_by_address = new Map();
    this._address_to_url_cache = new Map();
    // public properties
    this.schema = options.schema;
    this.router = options.router;
    this.api_routes = options.api_routes;
}

RPC.Client = Client;

/**
 *
 * register_service
 *
 */
RPC.prototype.register_service = function(api, server, options) {
    var self = this;
    options = options || {};

    dbg.log0('RPC register_service', api.id);

    _.each(api.methods, function(method_api, method_name) {
        var srv = api.id + '.' + method_name;
        assert(!self._services[srv],
            'RPC register_service: service already registered ' + srv);
        var func = server[method_name];
        if (!func && options.allow_missing_methods) {
            func = function() {
                return P.reject({
                    data: 'RPC register_service:' +
                        ' missing method implementation - ' +
                        method_api.fullname
                });
            };
        }
        assert.strictEqual(typeof(func), 'function',
            'RPC register_service: server method should be a function - ' +
            method_api.fullname + '. Is of type ' + typeof(func));

        self._services[srv] = {
            api: api,
            server: server,
            options: options,
            method_api: method_api,
            server_func: function() {
                return func.apply(server, arguments);
            }
        };
    });


    //Service was registered, call _init (if exists)
    if (server._init) {
        dbg.log0('RPC register_service: calling _init() for', api.id);
        server._init();
    }
};

/**
 *
 * is_service_registered
 *
 */
RPC.prototype.is_service_registered = function(api) {
    if (!this._services[api]) {
        return false;
    }
    return true;
};

RPC.prototype.new_client = function(options) {
    return new Client(this, options);
};


/**
 *
 * _request
 *
 * @param options Object:
 * - address: String - url for the request target.
 * - auth_token: String - token to send for request quthorization.
 * - timeout: Number - ms to wait for send-request/wait-for-reponse to complete
 */
RPC.prototype._request = function(api, method_api, params, options) {
    var self = this;
    // var millistamp = time_utils.millistamp();
    options = options || {};

    // initialize the request
    var req = new RpcRequest();
    req._new_request(api, method_api, params, options.auth_token);
    req._response_defer = P.defer();
    req._response_defer.promise.catch(_.noop); // to prevent error log of unhandled rejection
    if (options.tracker) {
        options.tracker(req);
    }

    if (!self._disable_validation) {
        try {
            req.method_api.validate_params(req.params, 'CLIENT');
        } catch (err) {
            return P.reject(new RpcError('BAD_REQUEST', err.message));
        }
    }

    // assign a connection to the request
    var conn = self._assign_connection(req, options);
    if (!conn) { // proxying
        return self._proxy(api, method_api, params, options);
    }

    const request_promise = P.resolve()
        .then(function() {

            dbg.log1('RPC._request: START',
                'srv', req.srv,
                'reqid', req.reqid);

            self._emit_stats('stats.request.start', req);

            // connect the connection
            return req.connection.connect();

        })
        .then(function() {

            dbg.log1('RPC._request: SEND',
                'srv', req.srv,
                'reqid', req.reqid);

            // encode the request buffer
            var req_buffers = req._encode_request();

            // send request over the connection
            return req.connection.send(req_buffers, 'req', req);

        })
        .then(function() {

            dbg.log1('RPC._request: WAIT',
                'srv', req.srv,
                'reqid', req.reqid);

            return req._response_defer.promise;

        })
        .then(function(reply) {

            if (!self._disable_validation) {
                try {
                    req.method_api.validate_reply(reply, 'CLIENT');
                } catch (err) {
                    throw new RpcError('BAD_REPLY', err.message);
                }
            }

            if (self._request_logger) {
                self._request_logger('RPC REQUEST', req.srv, params, '==>', reply);
            }

            dbg.log1('RPC._request: DONE',
                'srv', req.srv,
                'reqid', req.reqid);

            self._emit_stats('stats.request.done', req);

            if (options.return_rpc_req) {
                // this mode allows callers to get back the request
                // instead of a bare reply, and the reply is in req.reply
                return req;
            } else {
                return reply;
            }

        })
        .catch(function(err) {

            dbg.error('RPC._request: response ERROR',
                'srv', req.srv,
                'params', params,
                'reqid', req.reqid,
                err.stack || err);

            self._emit_stats('stats.request.error', req);

            throw err;

        })
        .finally(function() {
            // dbg.log0('RPC', req.srv, 'took', time_utils.millitook(millistamp));
            return self._release_connection(req);
        });

    if (options.timeout) {
        request_promise.timeout(options.timeout, 'RPC REQUEST TIMEOUT');
    }

    return request_promise;
};


/**
 *
 * _on_request
 *
 */
RPC.prototype._on_request = function(conn, msg) {
    var self = this;
    // var millistamp = time_utils.millistamp();
    var req = new RpcRequest();
    req.connection = conn;
    req.reqid = msg.header.reqid;

    // find the requested service
    var srv = msg.header.api +
        '.' + msg.header.method;
    var service = this._services[srv];
    if (!service) {
        dbg.warn('RPC._on_request: NOT FOUND', srv,
            'reqid', msg.header.reqid,
            'connid', conn.connid);
        req.error = new RpcError('NO_SUCH_RPC_SERVICE', 'No such RPC Service ' + srv);
        return conn.send(req._encode_response(), 'res', req);
    }

    return P.resolve()
        .then(function() {

            // set api info to the request
            req._set_request(msg, service.api, service.method_api);

            if (!self._disable_validation) {
                try {
                    req.method_api.validate_params(req.params, 'SERVER');
                } catch (err) {
                    throw new RpcError('BAD_REQUEST', err.message);
                }
            }

            dbg.log3('RPC._on_request: ENTER',
                'srv', req.srv,
                'reqid', req.reqid,
                'connid', conn.connid);

            self._emit_stats('stats.on_request.start', req);

            // call service middlewares if provided
            return _.reduce(service.options.middleware,
                (promise, middleware) => promise.then(() => middleware(req)),
                P.resolve());
        })
        .then(function() {

            // check if this request was already received and served,
            // and if so then join the requests promise so that it will try
            // not to call the server more than once.
            var cached_req = conn._received_requests.get(req.reqid);
            if (cached_req) {
                return cached_req._server_promise;
            }

            // insert to requests map and process using the server func
            conn._received_requests.set(req.reqid, req);
            req._server_promise = P.resolve()
                .then(() => service.server_func(req))
                .finally(function() {
                    // FUTURE TODO keep received requests for some time after with LRU?
                    conn._received_requests.delete(req.reqid);
                });

            return req._server_promise;

        })
        .then(function(reply) {

            if (!self._disable_validation) {
                try {
                    req.method_api.validate_reply(reply, 'SERVER');
                } catch (err) {
                    throw new RpcError('BAD_REPLY', err.message);
                }
            }

            req.reply = reply;

            dbg.log3('RPC._on_request: COMPLETED',
                'srv', req.srv,
                'reqid', req.reqid,
                'connid', conn.connid);

            self._emit_stats('stats.on_request.done', req);

            return conn.send(req._encode_response(), 'res', req);

        })
        .catch(err => {

            console.error('RPC._on_request: ERROR',
                'srv', req.srv,
                'reqid', req.reqid,
                'connid', conn.connid,
                err.stack || err);

            self._emit_stats('stats.on_request.error', req);

            // propagate rpc errors from inner rpc client calls (using err.rpc_code)
            // set default internal error if no other error was specified
            if (err instanceof RpcError) {
                req.error = err;
            } else {
                req.error = new RpcError(
                    err.rpc_code || 'INTERNAL',
                    err.message,
                    err.retryable);
            }

            return conn.send(req._encode_response(), 'res', req);

            // })
            // .finally(function() {
            // dbg.log0('RPC', req.srv, 'took', time_utils.millitook(millistamp));
        });
};


/**
 *
 * _on_response
 *
 */
RPC.prototype._on_response = function(conn, msg) {
    dbg.log1('RPC._on_response:',
        'reqid', msg.header.reqid,
        'connid', conn.connid);

    var req = conn._sent_requests.get(msg.header.reqid);
    if (!req) {
        dbg.warn('RPC._on_response: GOT RESPONSE BUT NO REQUEST',
            'reqid', msg.header.reqid,
            'connid', conn.connid);
        return;
    }

    var is_pending = req._set_response(msg);
    if (!is_pending) {
        dbg.warn('RPC._on_response: GOT RESPONSE BUT REQUEST NOT PENDING',
            'reqid', msg.header.reqid,
            'connid', conn.connid);
    }
};


RPC.prototype._get_remote_address = function(req, options) {
    var address = options.address;
    if (!address) {
        let domain = options.domain || this.api_routes[req.api.id] || 'default';
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
};

/**
 *
 * _assign_connection
 *
 */
RPC.prototype._assign_connection = function(req, options) {
    let conn = options.connection;
    if (!conn) {
        const addr_url = this._get_remote_address(req, options);
        conn = this._get_connection(addr_url, req.srv);
    }
    if (conn) {
        req.connection = conn;
        req.reqid = conn._alloc_reqid();
        conn._sent_requests.set(req.reqid, req);
    }
    return conn;
};

/**
 *
 * _release_connection
 *
 */
RPC.prototype._release_connection = function(req) {
    if (req.connection) {
        req.connection._sent_requests.delete(req.reqid);
    }
};


/**
 *
 * _get_connection
 *
 */
RPC.prototype._get_connection = function(addr_url, srv) {
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
        } else {
            conn = this._new_connection(addr_url);
            dbg.log2('RPC _get_connection: new',
                'address', addr_url.href,
                'srv', srv,
                'connid', conn.connid);
        }
    }

    return conn;
};


/**
 *
 */
RPC.prototype._new_connection = function(addr_url) {
    var conn;
    switch (addr_url.protocol) {
        // order protocols by popularity
        case 'n2n:':
            conn = new RpcN2NConnection(addr_url, this.n2n_agent);
            break;
        case 'ws:':
        case 'wss:':
            conn = new RpcWsConnection(addr_url);
            break;
        case 'fcall:':
            conn = new RpcFcallConnection(addr_url);
            break;
        case 'tls:':
        case 'tcp:':
            conn = new RpcTcpConnection(addr_url);
            break;
        case 'http:':
        case 'https:':
            conn = new RpcHttpConnection(addr_url);
            break;
        case 'nudp:':
            conn = new RpcNudpConnection(addr_url);
            break;
        case 'ntcp:':
        case 'ntls:':
            conn = new RpcNtcpConnection(addr_url);
            break;
        default:
            throw new Error('RPC new_connection: bad protocol ' + addr_url.href);
    }
    this._accept_new_connection(conn);
    return conn;
};


/**
 *
 */
RPC.prototype._accept_new_connection = function(conn) {
    var self = this;
    conn._sent_requests = new Map();
    conn._received_requests = new Map();
    if (self._disconnected_state) {
        conn.close();
        throw new Error('RPC IN DISCONNECTED STATE - rejecting connection ' + conn.connid);
    }
    conn.on('message', msg => self._on_message(conn, msg));
    conn.on('close', err => self._connection_closed(conn, err));
    // we prefer to let the connection handle it's own errors and decide if to close or not
    // conn.on('error', self._connection_error.bind(self, conn));

    if (!conn.transient) {
        // always replace previous connection in the address map,
        // assuming the new connection is preferred.
        dbg.log3('RPC NEW CONNECTION', conn.connid, conn.url.href);
        self._connection_by_address.set(conn.url.href, conn);

        // send pings to keepalive
        conn._ping_interval = setInterval(function() {
            dbg.log4('RPC PING', conn.connid);
            conn._ping_last_reqid = conn._alloc_reqid();
            P.resolve()
                .then(() => conn.send(RpcRequest.encode_message({
                    op: 'ping',
                    reqid: conn._ping_last_reqid
                })))
                .catch(_.noop); // already means the conn is closed
            return null;
        }, RPC_PING_INTERVAL_MS);
    }
};



/**
 *
 */
RPC.prototype._reconnect = function(addr_url, reconn_backoff) {
    // use the previous backoff for delay
    reconn_backoff = reconn_backoff || RECONN_BACKOFF_BASE;

    var conn = this._get_connection(addr_url, 'called from reconnect');
    // increase the backoff for the new connection,
    // so that if it closes the backoff will keep increasing up to max.
    if (conn._reconnect_timeout) return;
    conn._reconn_backoff = Math.min(
        reconn_backoff * RECONN_BACKOFF_FACTOR, RECONN_BACKOFF_MAX);
    conn._reconnect_timeout = setTimeout(() => {
        conn._reconnect_timeout = undefined;
        var conn2 = this._get_connection(addr_url, 'called from reconnect2');
        if (conn2 !== conn) return;
        P.resolve()
            .then(() => conn.connect())
            .then(() => {
                // remove the backoff once connected
                conn._reconn_backoff = undefined;
                dbg.log1('RPC RECONNECTED', addr_url.href,
                    'reconn_backoff', reconn_backoff.toFixed(0));
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
};


/**
 *
 */
RPC.prototype.set_disconnected_state = function(state) {
    if (state) {
        this._disconnected_state = true;
        this.disconnect_all();
    } else {
        this._disconnected_state = false;
    }
};


/**
 *
 */
RPC.prototype.disconnect_all = function() {
    var self = this;
    for (const conn of self._connection_by_address.values()) {
        // stop reconnect from picking up immediately
        conn._no_reconnect = true;
        conn.close();
    }
};


/**
 *
 */
RPC.prototype._connection_error = function(conn, err) {
    dbg.error('RPC CONNECTION ERROR:', conn.connid, conn.url.href, err.stack || err);
    conn.close();
};


/**
 *
 */
RPC.prototype._connection_closed = function(conn) {
    var self = this;

    dbg.log3('RPC _connection_closed:', conn.connid);

    // remove from connection pool
    if (!conn.transient && self._connection_by_address.get(conn.url.href) === conn) {
        self._connection_by_address.delete(conn.url.href);
    }

    // reject pending requests
    for (const req of conn._sent_requests.values()) {
        req.error = new RpcError(
            'DISCONNECTED',
            'connection closed ' + conn.connid + ' reqid ' + req.reqid,
            'retryable');
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
        self._reconnect(conn.url, conn._reconn_backoff);
    }
};


/**
 *
 */
RPC.prototype._on_message = function(conn, msg_buffer) {
    var self = this;

    // we allow to receive also objects that are already in "decoded" message form
    // which is useful by connections that want to produce errors without encoding them.
    // see for example in rpc_http.
    var msg = Buffer.isBuffer(msg_buffer) ?
        RpcRequest.decode_message(msg_buffer) :
        msg_buffer;

    if (!msg || !msg.header) {
        conn.emit('error', new Error('RPC._on_message: BAD MESSAGE' +
            ' typeof(msg) ' + typeof(msg) +
            ' typeof(msg.header) ' + typeof(msg && msg.header) +
            ' conn ' + conn.connid));
        return;
    }

    switch (msg.header.op) {
        case 'req':
            P.resolve()
                .then(function() {
                    return self._on_request(conn, msg);
                })
                .catch(function(err) {
                    dbg.warn('RPC._on_message: ERROR from _on_request', err.stack || err);
                });
            break;
        case 'res':
            self._on_response(conn, msg);
            break;
        case 'ping':
            dbg.log4('RPC PONG', conn.connid);
            P.resolve()
                .then(() => conn.send(RpcRequest.encode_message({
                    op: 'pong',
                    reqid: msg.header.reqid
                })))
                .catch(_.noop); // already means the conn is closed
            break;
        case 'pong':
            if (conn._ping_last_reqid === msg.header.reqid) {
                dbg.log4('RPC PINGPONG', conn.connid);
                conn._ping_mismatch_count = 0;
            } else {
                conn._ping_mismatch_count = (conn._ping_mismatch_count || 0) + 1;
                if (conn._ping_mismatch_count < 3) {
                    dbg.warn('RPC PINGPONG MISMATCH #' + conn._ping_mismatch_count, conn.connid);
                } else {
                    conn.close(new Error('RPC PINGPONG MISMATCH #' + conn._ping_mismatch_count + ' ' + conn.connid));
                }
            }
            break;
        default:
            conn.emit('error', new Error('RPC._on_message:' +
                ' BAD MESSAGE OP ' + msg.header.op +
                ' reqid ' + msg.header.reqid +
                ' connid ' + conn.connid));
            break;
    }
};

RPC.prototype._proxy = function(api, method, params, options) {
    var req = {
        method_api: api.id,
        method_name: method.name,
        target: options.address,
        request_params: params
    };

    // if we have buffer, add it as raw data.
    if (method.params_export_buffers) {
        req.proxy_buffer = buffer_utils.concatify(method.params_export_buffers(params));
        // dbg.log5('_proxy: params_export_buffers', req);
    }

    return P.resolve()
        .then(() => this.n2n_proxy(req))
        .then(res => {
            if (method.reply_import_buffers) {
                // dbg.log5('_proxy: reply_import_buffers', res);
                method.reply_import_buffers(res.proxy_reply, res.proxy_buffer);
            }
            return res.proxy_reply;
        });
};



RPC.prototype._emit_stats = function(name, data) {
    // FUTURE TODO COLLECT STATS
    // try {
    // this.emit(name, data);
    // } catch (err) {
    // dbg.error('RPC._emit_stats: ERROR', err.stack || err);
    // }
};


/**
 *
 * start_http_server
 *
 */
RPC.prototype.start_http_server = function(options) {
    dbg.log0('RPC start_http_server', options);
    var rpc_http_server = new RpcHttpServer();
    rpc_http_server.on('connection', conn => this._accept_new_connection(conn));
    return rpc_http_server.start(options)
        .then(http_server => {
            if (options.protocol === 'ws:' ||
                options.protocol === 'wss:') {
                this.register_ws_transport(http_server);
            }
            return http_server;
        });
};


/**
 *
 * register_http_transport
 *
 */
RPC.prototype.register_http_transport = function(express_app) {
    dbg.log0('RPC register_http_transport');
    var http_server = new RpcHttpServer();
    http_server.on('connection', conn => this._accept_new_connection(conn));
    http_server.install(express_app);
    return http_server;
};


/**
 *
 * register_ws_transport
 *
 */
RPC.prototype.register_ws_transport = function(http_server) {
    dbg.log0('RPC register_ws_transport');
    var ws_server = new RpcWsServer(http_server);
    ws_server.on('connection', conn => this._accept_new_connection(conn));
    return ws_server;
};


/**
 *
 * register_tcp_transport
 *
 */
RPC.prototype.register_tcp_transport = function(port, tls_options) {
    dbg.log0('RPC register_tcp_transport');
    var tcp_server = new RpcTcpServer(tls_options);
    tcp_server.on('connection', conn => this._accept_new_connection(conn));
    return P.resolve(tcp_server.listen(port)).return(tcp_server);
};


/**
 *
 * register_tcp_transport
 *
 */
RPC.prototype.register_ntcp_transport = function(port, tls_options) {
    dbg.log0('RPC register_ntcp_transport');
    var ntcp_server = new RpcNtcpServer(tls_options);
    ntcp_server.on('connection', conn => this._accept_new_connection(conn));
    return P.resolve(ntcp_server.listen(port)).return(ntcp_server);
};


/**
 *
 * register_nudp_transport
 *
 * this is not really like tcp listening, it only creates a one time
 * nudp connection that binds to the given port, and waits for a peer
 * to connect. after that connection is made, it ceases to listen for new connections,
 * and that udp port is used for the nudp connection.
 *
 */
RPC.prototype.register_nudp_transport = function(port) {
    var self = this;
    dbg.log0('RPC register_tcp_transport');
    var conn = new RpcNudpConnection(url_utils.quick_parse('nudp://0.0.0.0:0'));
    conn.on('connect', () => self._accept_new_connection(conn));
    return conn.accept(port);
};


/**
 *
 * register_n2n_agent
 *
 */
RPC.prototype.register_n2n_agent = function(send_signal_func) {
    if (this.n2n_agent) {
        console.log('RPC N2N already registered. ignoring');
        return this.n2n_agent;
    }
    dbg.log0('RPC register_n2n_agent');
    var n2n_agent = new RpcN2NAgent({
        send_signal: send_signal_func
    });
    n2n_agent.on('connection', conn => this._accept_new_connection(conn));
    this.n2n_agent = n2n_agent;
    return n2n_agent;
};

/**
 * this function allows the n2n protocol to accept connections.
 * it should called when a signal is accepted in order to process it by the n2n_agent.
 */
RPC.prototype.accept_n2n_signal = function(params) {
    return this.n2n_agent.accept_signal(params);
};


/**
 *
 * register_n2n_proxy
 *
 */
RPC.prototype.register_n2n_proxy = function(proxy_func) {
    dbg.log0('RPC register_n2n_proxy');
    this.n2n_proxy = proxy_func;
};

RPC.prototype.disable_validation = function() {
    this._disable_validation = true;
};

RPC.prototype.set_request_logger = function(request_logger) {
    this._request_logger = request_logger;
};


// EXPORTS
module.exports = RPC;
