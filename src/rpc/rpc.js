'use strict';

module.exports = RPC;

var _ = require('lodash');
var Q = require('q');
var url = require('url');
var util = require('util');
var assert = require('assert');
// var ip_module = require('ip');
var time_utils = require('../util/time_utils');
var dbg = require('noobaa-util/debug_module')(__filename);
var RpcRequest = require('./rpc_request');
var RpcWsConnection = require('./rpc_ws');
var RpcHttpConnection = require('./rpc_http');
var RpcN2NConnection = require('./rpc_n2n');
var RpcFcallConnection = require('./rpc_fcall');
var EventEmitter = require('events').EventEmitter;

// dbg.set_level(5, __dirname);

// allow self generated certificates for testing
// TODO NODE_TLS_REJECT_UNAUTHORIZED is not a proper flag to mess with...
process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

var browser_location = global.window && global.window.location;
var is_browser_secure = browser_location && browser_location.protocol === 'https:';
var browser_ws = global.window && global.window.WebSocket;

// default base address -
// in the browser we take the address as the host of the web page
// just like any ajax request. for development we take localhost.
// for any other case the RPC objects can set the base_address property.
var DEFAULT_BASE_ADDRESS = 'ws://127.0.0.1:5001';
var DEFAULT_BACKGROUND_ADDRESS = 'ws://127.0.0.1:5002';
if (browser_location) {
    if (browser_ws) {
        // use ws/s address
        DEFAULT_BASE_ADDRESS =
            (is_browser_secure ? 'wss://' : 'ws://') + browser_location.host;
    } else {
        // fallback to http/s address
        DEFAULT_BASE_ADDRESS =
            browser_location.protocol + '//' + browser_location.host;
    }
}


util.inherits(RPC, EventEmitter);

/**
 *
 * RPC
 *
 */
function RPC(options) {
    EventEmitter.call(this);
    this._services = {};
    this._connection_by_id = {};
    this._connection_by_address = {};

    options = options || {};

    this.base_address = options.base_address || DEFAULT_BASE_ADDRESS;

    // setup default client
    if (options.schema) {
        this.client = this.create_schema_client(options.schema, options);
    }
}


/**
 *
 * register_service
 *
 */
RPC.prototype.register_service = function(api, server, options) {
    var self = this;
    options = options || {};

    dbg.log0('RPC register_service', api.name);

    _.each(api.methods, function(method_api, method_name) {
        var srv = api.name + '.' + method_name;
        assert(!self._services[srv],
            'RPC register_service: service already registered ' + srv);
        var func = server[method_name];
        if (!func && options.allow_missing_methods) {
            func = function() {
                return Q.reject({
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
            server_func: func.bind(server)
        };
    });

    //Service was registered, call _init (if exists)
    if (typeof(server._init) !== 'undefined') {
        dbg.log0('RPC register_service: calling _int() for', api.name);
        server._init();
    } else {
        dbg.log2('RPC register_service:', api.name, 'does not supply an _init() function');
    }
};


/**
 *
 * create_schema_client
 *
 */
RPC.prototype.create_schema_client = function(schema, default_options) {
    var self = this;
    var client = {
        options: _.create(default_options)
    };
    _.each(schema, function(api, api_name) {
        if (api_name && api_name[0] !== '_') {
            var name = api_name.replace(/_api$/, '');
            client[name] = self.create_client(api, client.options);
        }
    });
    return client;
};

/**
 *
 * create_client
 *
 */
RPC.prototype.create_client = function(api, default_options) {
    var self = this;
    var client = {
        options: _.create(default_options)
    };
    if (!api || !api.name || !api.methods) {
        throw new Error('RPC create_client: BAD API');
    }

    // create client methods
    _.each(api.methods, function(method_api, method_name) {
        client[method_name] = function(params, options) {
            options = _.create(client.options, options);
            return self.client_request(api, method_api, params, options);
        };
    });

    return client;
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
    var millistamp = time_utils.millistamp();
    options = options || {};

    // initialize the request
    var req = new RpcRequest();
    req.new_request(api, method_api, params, options.auth_token);
    req.response_defer = Q.defer();

    return Q.fcall(function() {

            // assign a connection to the request
            self._assign_connection(req, options);

            dbg.log1('RPC client_request: START',
                'srv', req.srv,
                'reqid', req.reqid);

            self.emit_stats('stats.client_request.start', req);

            // connect the connection
            return Q.invoke(req.connection, 'connect');

        })
        .then(function() {

            dbg.log1('RPC client_request: SEND',
                'srv', req.srv,
                'reqid', req.reqid);

            // encode the request buffer (throws if params are not valid)
            var req_buffers = req.export_request_buffers();

            // send request over the connection
            var send_promise = Q.invoke(req.connection, 'send', req_buffers, 'req', req);

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

            dbg.log1('RPC client_request: DONE',
                'srv', req.srv,
                'reqid', req.reqid);

            self.emit_stats('stats.client_request.done', req);

            return reply;

        })
        .then(null, function(err) {

            dbg.error('RPC client_request: response ERROR',
                'srv', req.srv,
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
    var millistamp = time_utils.millistamp();
    var req = new RpcRequest();
    req.connection = conn;
    var rseq = conn._rpc_req_seq || 1;
    conn._rpc_req_seq = rseq + 1;
    req.reqid = rseq + '@' + conn.connid;

    // find the requested service
    var srv = msg.header.api +
        '.' + msg.header.method;
    var service = this._services[srv];
    if (!service) {
        dbg.warn('RPC handle_request: NOT FOUND', srv,
            'reqid', msg.header.reqid,
            'connid', conn.connid);
        req.rpc_error('NOT_FOUND', srv + ' not found');
        return conn.send(req.export_response_buffer(), 'res', req);
    }

    return Q.fcall(function() {

            // set api info to the request
            req.import_request_message(msg, service.api, service.method_api);

            // we allow to authorize once per connection -
            // if the request did not send specific token, use the conn level token.
            if (!req.auth_token) {
                // TODO better save conn.auth parsed instead of reparsing the token again
                req.auth_token = conn.auth_token;
            }

            dbg.log3('RPC handle_request: ENTER',
                'srv', req.srv,
                'reqid', req.reqid,
                'connid', conn.connid);

            self.emit_stats('stats.handle_request.start', req);

            // authorize the request
            if (service.options.authorize) {
                return service.options.authorize(req);
            }

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
            req.server_promise = Q.fcall(service.server_func, req)
                .fin(function() {
                    // TODO keep received requests for some time after with LRU?
                    delete conn._received_requests[req.reqid];
                });

            return req.server_promise;

        })
        .then(function(reply) {

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
                req.rpc_error(err.rpc_code, err.message);
            }

            return conn.send(req.export_response_buffer(), 'res', req);
        })
        .fin(function() {
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
 * map_address_to_connection
 *
 */
RPC.prototype.map_address_to_connection = function(address, conn) {
    this._connection_by_address[address] = conn;
};


/**
 *
 * _assign_connection
 *
 */
RPC.prototype._assign_connection = function(req, options) {
    var address = options.address || this.base_address;
    var addr_url = url.parse(address, true);
    var conn = this._get_connection(addr_url, req.srv);
    var rseq = conn._rpc_req_seq;
    req.connection = conn;
    req.reqid = rseq + '@' + conn.connid;
    conn._rpc_req_seq = rseq + 1;
    conn._sent_requests[req.reqid] = req;
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
RPC.prototype._get_connection = function(addr_url, srv) {
    var conn = this._connection_by_address[addr_url.href];

    if (conn) {
        if (conn.closed) {
            dbg.log0('RPC _assign_connection: remove stale connection',
                'address', addr_url.href,
                'srv', srv,
                'connid', conn.connid);
            delete this._connection_by_address[addr_url.href];
            conn = null;
        } else {
            dbg.log2('RPC _assign_connection: existing',
                'address', addr_url.href,
                'srv', srv,
                'connid', conn.connid);
        }
    }

    if (!conn) {
        conn = this._new_connection(addr_url);
        dbg.log1('RPC _assign_connection: new',
            'address', addr_url.href,
            'srv', srv,
            'connid', conn.connid);
    }

    return conn;
};


/**
 *
 */
RPC.prototype._new_connection = function(addr_url) {
    var conn;
    switch (addr_url.protocol) {
        case 'n2n:':
            conn = new RpcN2NConnection(addr_url, this.n2n_agent);
            break;
        case 'ws:':
        case 'wss:':
            conn = new RpcWsConnection(addr_url);
            break;
        case 'http:':
        case 'https:':
            conn = new RpcHttpConnection(addr_url);
            break;
        case 'fcall:':
            conn = new RpcFcallConnection(addr_url);
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
    // always replace previous connection in the address map,
    // assuming the new connection is preferred.
    if (!conn.transient) {
        dbg.log3('RPC NEW CONNECTION', conn.connid, conn.url.href);
        this._connection_by_address[conn.url.href] = conn;
    }
    conn._rpc_req_seq = 1;
    conn._sent_requests = {};
    conn._received_requests = {};
    conn.on('message', this._connection_receive.bind(this, conn));
    conn.on('close', this._connection_closed.bind(this, conn));

    // we prefer to let the connection handle it's own errors and decide if to close or not
    // conn.on('error', this._connection_error.bind(this, conn));
};


var RECONN_BACKOFF_BASE = 1000;
var RECONN_BACKOFF_MAX = 15000;
var RECONN_BACKOFF_FACTOR = 1.1;


/**
 *
 */
RPC.prototype._reconnect = function(addr_url, reconn_backoff) {
    var self = this;
    var conn;

    // use the previous backoff for delay
    reconn_backoff = reconn_backoff || RECONN_BACKOFF_BASE;

    Q.delay(reconn_backoff)
        .then(function() {

            // create new connection (if not present)
            return self._get_connection(addr_url, 'reconnect');

        })
        .then(function(conn_arg) {
            conn = conn_arg;

            // increase the backoff for the new connection,
            // so that if it closes the backoff will keep increasing up to max.
            conn._reconn_backoff = Math.min(
                reconn_backoff * RECONN_BACKOFF_FACTOR, RECONN_BACKOFF_MAX);

            return Q.invoke(conn, 'connect');

        })
        .then(function() {

            // remove the backoff once connected
            delete conn._reconn_backoff;

            dbg.log1('RPC RECONNECTED', addr_url.href,
                'reconn_backoff', reconn_backoff);

            self.emit('reconnect', conn);

        }, function(err) {

            // since the new connection should already listen for close events,
            // then this path will be called again from there,
            // so no need to loop and retry from here.
            dbg.warn('RPC RECONNECT FAILED', addr_url.href,
                'reconn_backoff', reconn_backoff,
                err.stack || err);

        });
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

    conn.closed = true;

    dbg.log3('RPC _connection_closed:', conn.connid);

    // remove from connection pool
    if (!conn.transient && self._connection_by_address[conn.url.href] === conn) {
        delete self._connection_by_address[conn.url.href];
    }

    // reject pending requests
    _.each(conn._sent_requests, function(req) {
        dbg.warn('RPC _connection_closed: reject reqid', req.reqid,
            'connid', conn.connid);
        req.rpc_error('DISCONNECTED', 'connection closed ' + conn.connid);
    });

    // for base_address try to reconnect after small delay.
    // using _.startsWith() since in some cases url.parse will add a trailing /
    // specifically in http urls for some strange reason...
    if (!conn._no_reconnect && _.startsWith(conn.url.href, self.base_address)) {
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
            return self.handle_request(conn, msg);
        case 'res':
            return self.handle_response(conn, msg);
        default:
            conn.emit('error', new Error('RPC _connection_receive:' +
                ' BAD MESSAGE OP ' + msg.header.op +
                ' reqid ' + msg.header.reqid +
                ' connid ' + conn.connid));
            break;
    }
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
RPC.prototype.start_http_server = function(port, secure, logging) {
    dbg.log0('RPC start_http_server port', port, secure ? 'secure' : '');
    var http_server = new RpcHttpConnection.Server();
    http_server.on('connection', this._accept_new_connection.bind(this));
    return http_server.start(port, secure, logging);
};


/**
 *
 * register_http_transport
 *
 */
RPC.prototype.register_http_transport = function(express_app) {
    dbg.log0('RPC register_http_transport');
    var http_server = new RpcHttpConnection.Server();
    http_server.on('connection', this._accept_new_connection.bind(this));
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
    var ws_server = new RpcWsConnection.Server(http_server);
    ws_server.on('connection', this._accept_new_connection.bind(this));
    return ws_server;
};


/**
 *
 * register_n2n_transport
 *
 */
RPC.prototype.register_n2n_transport = function() {
    if (this.n2n_agent) {
        return this.n2n_agent;
    }
    dbg.log0('RPC register_n2n_transport');
    var n2n_agent = new RpcN2NConnection.Agent({
        signaller: this.n2n_signaller,
    });
    n2n_agent.on('connection', this._accept_new_connection.bind(this));
    this.n2n_agent = n2n_agent;
    return n2n_agent;
};

/**
 *
 */
RPC.prototype.n2n_signal = function(params) {
    return this.n2n_agent.signal(params);
};

RPC.prototype.get_default_base_address = function(server) {
    if (server === 'background') {
      return DEFAULT_BACKGROUND_ADDRESS;
    }
    return DEFAULT_BASE_ADDRESS;
};
