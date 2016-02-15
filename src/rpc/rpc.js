'use strict';

module.exports = RPC;

var _ = require('lodash');
var P = require('../util/promise');
var util = require('util');
var assert = require('assert');
// var ip_module = require('ip');
// var time_utils = require('../util/time_utils');
var url_utils = require('../util/url_utils');
var dbg = require('../util/debug_module')(__filename);
var RpcRequest = require('./rpc_request');
var RpcWsConnection = require('./rpc_ws');
var RpcWsServer = require('./rpc_ws_server');
var RpcHttpConnection = require('./rpc_http');
var RpcHttpServer = require('./rpc_http_server');
var RpcTcpConnection = require('./rpc_tcp');
var RpcTcpServer = require('./rpc_tcp_server');
var RpcNudpConnection = require('./rpc_nudp');
var RpcN2NConnection = require('./rpc_n2n');
var RpcN2NAgent = require('./rpc_n2n_agent');
var RpcFcallConnection = require('./rpc_fcall');
var EventEmitter = require('events').EventEmitter;

// dbg.set_level(5, __dirname);

var RPC_PING_INTERVAL_MS = 20000;
var RECONN_BACKOFF_BASE = 1000;
var RECONN_BACKOFF_MAX = 10000;
var RECONN_BACKOFF_FACTOR = 1.2;


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
                    return rpc.client_request(api, method_api, params, options);
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
    this._connection_by_id = {};
    this._connection_by_address = {};
    this._address_to_url_cache = {};
    // public properties
    this.schema = options.schema;
    this.router = options.router;
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
    if (typeof(server._init) !== 'undefined') {
        dbg.log0('RPC register_service: calling _init() for', api.id);
        server._init();
    } else {
        dbg.log2('RPC register_service:', api.id, 'does not supply an _init() function');
    }
};

RPC.prototype.new_client = function(options) {
    return new Client(this, options);
};


/**
 *
 * client_request
 *
 * @param options Object:
 * - address: String - url for the request target.
 * - auth_token: String - token to send for request quthorization.
 * - timeout: Number - ms to wait for send-request/wait-for-reponse to complete
 */
RPC.prototype.client_request = function(api, method_api, params, options) {
    var self = this;
    // var millistamp = time_utils.millistamp();
    options = options || {};

    // initialize the request
    var req = new RpcRequest();
    req.new_request(api, method_api, params, options.auth_token);
    req.response_defer = P.defer();
    req.response_defer.promise.catch(_.noop); // to prevent error log of unhandled rejection
    if (options.tracker) {
        options.tracker(req);
    }

    if (!self._disable_validation) {
        try {
            req.method_api.validate_params(req.params, 'CLIENT');
        } catch (err) {
            throw req.rpc_error('BAD_REQUEST', err, {
                nostack: true
            });
        }
    }

    // assign a connection to the request
    var conn = self._assign_connection(req, options);
    if (!conn) { //redirection
        return self._redirect(api, method_api, params, options);
    }

    return P.fcall(function() {
            dbg.log1('RPC client_request: START',
                'srv', req.srv,
                'reqid', req.reqid);

            self.emit_stats('stats.client_request.start', req);

            // connect the connection
            return req.connection.connect();

        })
        .then(function() {

            dbg.log1('RPC client_request: SEND',
                'srv', req.srv,
                'reqid', req.reqid);

            // encode the request buffer (throws if params are not valid)
            var req_buffers = req.export_request_buffers();

            // send request over the connection
            var send_promise = P.invoke(req.connection, 'send', req_buffers, 'req', req);

            // set timeout to abort if the specific connection/transport
            // can do anything with it, for http this calls req.abort()
            if (options.timeout) {
                send_promise = send_promise.timeout(
                    options.timeout, 'RPC client_request: send TIMEOUT');
            }

            return send_promise;

        })
        .then(function() {

            dbg.log1('RPC client_request: WAIT',
                'srv', req.srv,
                'reqid', req.reqid);

            var reply_promise = req.response_defer.promise;

            if (options.timeout) {
                reply_promise = reply_promise.timeout(
                    options.timeout, 'RPC client_request: response TIMEOUT');
            }

            return reply_promise;

        })
        .then(function(reply) {

            if (!self._disable_validation) {
                try {
                    req.method_api.validate_reply(reply, 'CLIENT');
                } catch (err) {
                    throw req.rpc_error('BAD_REPLY', err, {
                        nostack: true
                    });
                }
            }

            if (self._request_logger) {
                self._request_logger('RPC REQUEST', req.srv, params, '==>', reply);
            }

            dbg.log1('RPC client_request: DONE',
                'srv', req.srv,
                'reqid', req.reqid);

            self.emit_stats('stats.client_request.done', req);

            if (options.return_rpc_req) {
                // this mode allows callers to get back the request
                // instead of a bare reply, and the reply is in req.reply
                return req;
            } else {
                return reply;
            }

        })
        .fail(function(err) {

            dbg.error('RPC client_request: response ERROR',
                'srv', req.srv,
                'params', params,
                'reqid', req.reqid,
                err.stack || err);

            self.emit_stats('stats.client_request.error', req);

            // TODO:
            // move to rpc_code and retries - postponed for now

            if (err.message === 'RPC client_request: send TIMEOUT') {
                dbg.log1('closing connection due to timeout');
                self._connection_closed(req.connection);
            }

            throw err;

        })
        .fin(function() {
            // dbg.log0('RPC', req.srv, 'took', time_utils.millitook(millistamp));
            return self._release_connection(req);
        });
};


/**
 *
 * handle_request
 *
 */
RPC.prototype.handle_request = function(conn, msg) {
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
        dbg.warn('RPC handle_request: NOT FOUND', srv,
            'reqid', msg.header.reqid,
            'connid', conn.connid);
        req.rpc_error('NOT_FOUND', srv + ' not found', {
            nostack: true
        });
        return conn.send(req.export_response_buffer(), 'res', req);
    }

    return P.fcall(function() {

            // set api info to the request
            req.import_request_message(msg, service.api, service.method_api);

            if (!self._disable_validation) {
                try {
                    req.method_api.validate_params(req.params, 'SERVER');
                } catch (err) {
                    throw req.rpc_error('BAD_REQUEST', err, {
                        nostack: true
                    });
                }
            }

            dbg.log3('RPC handle_request: ENTER',
                'srv', req.srv,
                'reqid', req.reqid,
                'connid', conn.connid);

            self.emit_stats('stats.handle_request.start', req);

            // call service middlewares if provided
            return _.reduce(service.options.middleware,
                (promise, middleware) => promise.then(() => middleware(req)),
                P.resolve());
        })
        .then(function() {

            // check if this request was already received and served,
            // and if so then join the requests promise so that it will try
            // not to call the server more than once.
            var cached_req = conn._received_requests[req.reqid];
            if (cached_req) {
                return cached_req.server_promise;
            }

            // insert to requests map and process using the server func
            conn._received_requests[req.reqid] = req;
            req.server_promise = P.fcall(service.server_func, req)
                .fin(function() {
                    // TODO keep received requests for some time after with LRU?
                    delete conn._received_requests[req.reqid];
                });

            return req.server_promise;

        })
        .then(function(reply) {

            if (!self._disable_validation) {
                try {
                    req.method_api.validate_reply(reply, 'SERVER');
                } catch (err) {
                    throw req.rpc_error('BAD_REPLY', err, {
                        nostack: true
                    });
                }
            }

            req.reply = reply;

            dbg.log3('RPC handle_request: COMPLETED',
                'srv', req.srv,
                'reqid', req.reqid,
                'connid', conn.connid);

            self.emit_stats('stats.handle_request.done', req);

            return conn.send(req.export_response_buffer(), 'res', req);

        })
        .then(null, function(err) {

            console.error('RPC handle_request: ERROR',
                'srv', req.srv,
                'reqid', req.reqid,
                'connid', conn.connid,
                err.stack || err);

            self.emit_stats('stats.handle_request.error', req);

            // propagate rpc errors from inner rpc client calls (using err.rpc_code)
            // set default internal error if no other error was specified
            if (!req.error) {
                req.rpc_error(err.rpc_code, err.message, {
                    quiet: true
                });
            }

            return conn.send(req.export_response_buffer(), 'res', req);

            // })
            // .fin(function() {
            // dbg.log0('RPC', req.srv, 'took', time_utils.millitook(millistamp));
        });
};


/**
 *
 * handle_response
 *
 */
RPC.prototype.handle_response = function(conn, msg) {
    dbg.log1('RPC handle_response:',
        'reqid', msg.header.reqid,
        'connid', conn.connid);

    var req = conn._sent_requests[msg.header.reqid];
    if (!req) {
        dbg.log0('RPC handle_response: GOT RESPONSE BUT NO REQUEST',
            'reqid', msg.header.reqid,
            'connid', conn.connid);
        // TODO stats?
        return;
    }

    var is_pending = req.import_response_message(msg);
    if (!is_pending) {
        dbg.log0('RPC handle_response: GOT RESPONSE BUT REQUEST NOT PENDING',
            'reqid', msg.header.reqid,
            'connid', conn.connid);
        // TODO stats?
        return;
    }
};


/**
 *
 * _assign_connection
 *
 */
RPC.prototype._assign_connection = function(req, options) {
    var address = options.address;
    if (!address) {
        address = this.router[options.domain || 'default'];
    }
    assert(address, 'No RPC Address/Domain');
    var addr_url = this._address_to_url_cache[address];
    if (!addr_url) {
        addr_url = url_utils.quick_parse(address, true);
        this._address_to_url_cache[address] = addr_url;
    }
    var conn = this._get_connection(addr_url, req.srv, options.force_redirect);
    if (conn !== null) {
        req.connection = conn;
        req.reqid = conn._alloc_reqid();
        conn._sent_requests[req.reqid] = req;
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
        delete req.connection._sent_requests[req.reqid];
    }
};


/**
 *
 * _get_connection
 *
 */
RPC.prototype._get_connection = function(addr_url, srv, force_redirect) {
    var conn = this._connection_by_address[addr_url.href];

    if (conn && !force_redirect) {
        if (conn.is_closed()) {
            dbg.log0('RPC _get_connection: remove stale connection',
                'address', addr_url.href,
                'srv', srv,
                'connid', conn.connid);
            delete this._connection_by_address[addr_url.href];
            conn = null;
        } else {
            dbg.log2('RPC _get_connection: existing',
                'address', addr_url.href,
                'srv', srv,
                'connid', conn.connid);
        }
    }

    if (!conn || force_redirect) {
        if (this._send_redirection &&
            addr_url.protocol === 'n2n:') {
            dbg.log2('RPC redirecting',
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
    conn._sent_requests = {};
    conn._received_requests = {};
    conn.on('message', function(msg) {
        return self._connection_receive(conn, msg);
    });
    conn.on('close', function(err) {
        return self._connection_closed(conn, err);
    });
    // we prefer to let the connection handle it's own errors and decide if to close or not
    // conn.on('error', self._connection_error.bind(self, conn));

    if (!conn.transient) {
        // always replace previous connection in the address map,
        // assuming the new connection is preferred.
        dbg.log3('RPC NEW CONNECTION', conn.connid, conn.url.href);
        self._connection_by_address[conn.url.href] = conn;

        // send pings to keepalive
        conn._ping_interval = setInterval(function() {
            dbg.log4('RPC PING', conn.connid);
            conn._ping_last_reqid = conn._alloc_reqid();
            P.invoke(conn, 'send', RpcRequest.encode_message({
                op: 'ping',
                reqid: conn._ping_last_reqid
            })).fail(_.noop); // already means the conn is closed
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
        P.fcall(() => conn.connect())
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
                    'reconn_backoff', reconn_backoff.toFixed(0),
                    err.stack || err);
            });
    }, reconn_backoff);
};


/**
 *
 */
RPC.prototype.disconnect_all = function() {
    var self = this;
    _.each(self._connection_by_address, function(conn) {
        // stop reconnect from picking up immediately
        conn._no_reconnect = true;
        conn.close();
    });
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
    if (!conn.transient && self._connection_by_address[conn.url.href] === conn) {
        delete self._connection_by_address[conn.url.href];
    }

    // reject pending requests
    _.each(conn._sent_requests, function(req) {
        req.rpc_error('DISCONNECTED', 'connection closed ' + conn.connid + ' reqid ' + req.reqid, {
            level: 'warn',
            nostack: true
        });
    });

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
    if (!conn._no_reconnect && (
            _.startsWith(conn.url.href, this.router.default) ||
            _.startsWith(conn.url.href, this.router.bg))) {
        self._reconnect(conn.url, conn._reconn_backoff);
    }
};


/**
 *
 */
RPC.prototype._connection_receive = function(conn, msg_buffer) {
    var self = this;

    // we allow to receive also objects that are already in "decoded" message form
    // which is useful by connections that want to produce errors without encoding them.
    // see for example in rpc_http.
    var msg = Buffer.isBuffer(msg_buffer) ?
        RpcRequest.decode_message(msg_buffer) :
        msg_buffer;

    if (!msg || !msg.header) {
        conn.emit('error', new Error('RPC _connection_receive: BAD MESSAGE' +
            ' typeof(msg) ' + typeof(msg) +
            ' typeof(msg.header) ' + typeof(msg && msg.header) +
            ' conn ' + conn.connid));
        return;
    }

    switch (msg.header.op) {
        case 'req':
            P.fcall(function() {
                return self.handle_request(conn, msg);
            }).fail(function(err) {
                dbg.warn('RPC _connection_receive: ERROR from handle_request', err.stack || err);
            }).done();
            break;
        case 'res':
            self.handle_response(conn, msg);
            break;
        case 'ping':
            dbg.log4('RPC PONG', conn.connid);
            P.invoke(conn, 'send', RpcRequest.encode_message({
                op: 'pong',
                reqid: msg.header.reqid
            })).fail(_.noop); // already means the conn is closed
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
            conn.emit('error', new Error('RPC _connection_receive:' +
                ' BAD MESSAGE OP ' + msg.header.op +
                ' reqid ' + msg.header.reqid +
                ' connid ' + conn.connid));
            break;
    }
};

RPC.prototype._redirect = function(api, method, params, options) {
    var req = {
        method_api: api.id,
        method_name: method.name,
        target: options.address,
        request_params: params
    };
    dbg.log3('redirecting ', req);
    return P.fcall(this._send_redirection, req);
};



RPC.prototype.emit_stats = function(name, data) {
    // TODO COLLECT STATS
    // try {
    // this.emit(name, data);
    // } catch (err) {
    // dbg.error('RPC emit_stats: ERROR', err.stack || err);
    // }
};


/**
 *
 * start_http_server
 *
 */
RPC.prototype.start_http_server = function(options) {
    dbg.log0('RPC start_http_server', options);
    var http_server = new RpcHttpServer();
    http_server.on('connection', conn => this._accept_new_connection(conn));
    return http_server.start(options)
        .then(http_server => {
            if (options.ws) {
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
    return P.when(tcp_server.listen(port)).return(tcp_server);
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
 * register_n2n_transport
 *
 */
RPC.prototype.register_n2n_transport = function(send_signal_func) {
    if (this.n2n_agent) {
        throw new Error('RPC N2N already registered');
    }
    dbg.log0('RPC register_n2n_transport');
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
 * register_redirector_transport
 *
 */
RPC.prototype.register_redirector_transport = function(send_redirection_func) {
    dbg.log0('RPC register_redirector_transport');
    this._send_redirection = send_redirection_func;
};

RPC.prototype.disable_validation = function() {
    this._disable_validation = true;
};

RPC.prototype.set_request_logger = function(request_logger) {
    this._request_logger = request_logger;
};

/**
 *
 * map_address_to_connection
 * return true if address was associated to same conn
 * false otherwise
 */
RPC.prototype.map_address_to_connection = function(address, conn) {
    if (_.has(this._connection_by_address, address) &&
        _.isEqual(this._connection_by_address[address], conn)) {
        return false;
    }
    this._connection_by_address[address] = conn;
    return true;
};

/**
 *
 * return all n2n registered connections
 */
RPC.prototype.get_n2n_addresses = function() {
    var addresses = [];
    _.each(this._connection_by_address, function(conn, address) {
        if (address.indexOf('n2n://') !== -1) {
            addresses.push(address.slice(6));
        }
    });
    return addresses;
};
