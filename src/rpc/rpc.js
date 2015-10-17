'use strict';

module.exports = RPC;

var _ = require('lodash');
var P = require('../util/promise');
var url = require('url');
var util = require('util');
var assert = require('assert');
// var ip_module = require('ip');
// var time_utils = require('../util/time_utils');
var url_utils = require('../util/url_utils');
var dbg = require('../util/debug_module')(__filename);
var RpcRequest = require('./rpc_request');
var RpcWsConnection = require('./rpc_ws');
var RpcHttpConnection = require('./rpc_http');
var RpcTcpConnection = require('./rpc_tcp');
var RpcNudpConnection = require('./rpc_nudp');
var RpcN2NConnection = require('./rpc_n2n');
var RpcFcallConnection = require('./rpc_fcall');
var EventEmitter = require('events').EventEmitter;

// dbg.set_level(5, __dirname);

var browser_location = global.window && global.window.location;
var is_browser_secure = browser_location && browser_location.protocol === 'https:';
var browser_ws = global.window && global.window.WebSocket;

// default base address -
// in the browser we take the address as the host of the web page
// just like any ajax request. for development we take localhost.
// for any other case the RPC objects can set the base_address property.
var DEFAULT_BASE_ADDRESS = 'ws://127.0.0.1:' + get_default_base_port();
var DEFAULT_BACKGROUND_ADDRESS = 'ws://127.0.0.1:' + get_default_base_port('background');
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

var RPC_PING_INTERVAL_MS = 20000;
var RECONN_BACKOFF_BASE = 1000;
var RECONN_BACKOFF_MAX = 15000;
var RECONN_BACKOFF_FACTOR = 1.2;

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
    this._address_to_url_cache = {};

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
    // var millistamp = time_utils.millistamp();
    options = options || {};

    // initialize the request
    var req = new RpcRequest();
    req.new_request(api, method_api, params, options.auth_token);
    req.response_defer = P.defer();

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
        req.rpc_error('NOT_FOUND', srv + ' not found');
        return conn.send(req.export_response_buffer(), 'res', req);
    }

    return P.fcall(function() {

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
            req.server_promise = P.fcall(service.server_func, req)
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

/**
 *
 * _assign_connection
 *
 */
RPC.prototype._assign_connection = function(req, options) {
    var address = options.address || this.base_address;
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

    if (!conn || force_redirect) {
        if (this.redirector_transport &&
            addr_url.protocol === 'n2n:') {
            dbg.log2('RPC redirecting',
                'address', addr_url.href,
                'srv', srv);
            return null;
        } else {
            conn = this._new_connection(addr_url);
            dbg.log2('RPC _assign_connection: new',
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
        case 'n2n:':
            conn = new RpcN2NConnection(addr_url, this.n2n_agent);
            break;
        case 'tls:':
        case 'tcp:':
            conn = new RpcTcpConnection(addr_url);
            break;
        case 'nudp:':
            conn = new RpcNudpConnection(addr_url);
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
    var self = this;
    var conn;

    // use the previous backoff for delay
    reconn_backoff = reconn_backoff || RECONN_BACKOFF_BASE;

    P.delay(reconn_backoff)
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

            return conn.connect();

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

    if (conn._ping_interval) {
        clearInterval(conn._ping_interval);
        conn._ping_interval = null;
    }

    // for base_address try to reconnect after small delay.
    if (!conn._no_reconnect && self._should_reconnect(conn.url.href)) {
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
    var self = this;
    var req = {
        method_api: api.name,
        method_name: method.name,
        target: options.address,
        request_params: params
    };
    dbg.log3('redirecting ', req, 'to', self.redirector_transport.href);

    return P.when(self.redirection(req, {
        address: self.redirector_transport.href,
    }));
};

RPC.prototype._should_reconnect = function(href) {
    var self = this;
    // using _.startsWith() since in some cases url.parse will add a trailing /
    // specifically in http urls for some strange reason...
    if (_.startsWith(href, self.get_default_base_address()) ||
        _.startsWith(href, self.get_default_base_address('background'))) {
        return true;
    }
    return false;
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
 * register_tcp_transport
 *
 */
RPC.prototype.register_tcp_transport = function(port, tls_options) {
    dbg.log0('RPC register_tcp_transport');
    var tcp_server = new RpcTcpConnection.Server(tls_options);
    tcp_server.on('connection', this._accept_new_connection.bind(this));
    tcp_server.listen(port);
    return tcp_server;
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
    conn.on('connect', function() {
        self._accept_new_connection(conn);
    });
    return conn.accept(port);
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
 * this function allows the n2n protocol to accept connections.
 * it should called when a signal is accepted in order to process it by the n2n_agent.
 */
RPC.prototype.n2n_signal = function(params) {
    return this.n2n_agent.signal(params);
};


/**
 *
 * register_redirector_transport
 *
 */
RPC.prototype.register_redirector_transport = function() {
    dbg.log0('RPC register_redirector_transport');
    this.redirector_transport = url.parse(this.get_default_base_address('background'));
    return;
};

RPC.prototype.get_default_base_address = function(server) {
    if (server === 'background') {
        return DEFAULT_BACKGROUND_ADDRESS;
    }
    return DEFAULT_BASE_ADDRESS;
};

RPC.prototype.get_default_base_port = function(server) {
    return get_default_base_port(server);
};

function get_default_base_port(server) {
    // the default 5001 port is for development
    var base_port = parseInt(process.env.PORT, 10) || 5001;
    if (server === 'background') {
        base_port += 1;
    }
    return base_port;
}
