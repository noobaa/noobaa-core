'use strict';

module.exports = RPC;

var _ = require('lodash');
var Q = require('q');
var url = require('url');
var util = require('util');
var assert = require('assert');
// var ip_module = require('ip');
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

    _.each(api.methods, function(method_api, method_name) {
        var peer = options.peer || '';
        var srv = '/' + peer + '/' + api.name + '/' + method_name;
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
            method_api.fullname);

        self._services[srv] = {
            api: api,
            server: server,
            options: options,
            method_api: method_api,
            server_func: func.bind(server)
        };
    });
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
 */
RPC.prototype.client_request = function(api, method_api, params, options) {
    var self = this;
    options = options || {};
    var peer = options.peer || '';

    // initialize the request
    var req = new RpcRequest();
    req.new_request(peer, api, method_api, params, options.auth_token);
    req.response_defer = Q.defer();

    return Q.fcall(function() {

            // assign a connection to the request
            self._assign_connection(req, options);

            dbg.log1('RPC client_request: START',
                'srv', req.srv,
                'reqid', req.reqid);

            self.emit_stats('stats.client_request.start', req);

            // connect the connection
            return Q.invoke(req.connection, 'connect', options);

        })
        .then(function() {

            dbg.log1('RPC client_request: SEND',
                'srv', req.srv,
                'reqid', req.reqid);

            // encode the request buffer (throws if params are not valid)
            var req_buffer = req.export_request_buffer();

            // send request over the connection
            var send_promise = Q.invoke(req.connection, 'send', req_buffer, 'req', req);

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

            throw err;

        })
        .fin(function() {
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
    var req = new RpcRequest();
    req.connection = conn;
    var rseq = conn._rpc_req_seq || 1;
    conn._rpc_req_seq = rseq + 1;
    req.reqid = rseq + '@' + conn.connid;

    // find the requested service
    var srv =
        '/' + msg.header.peer +
        '/' + msg.header.api +
        '/' + msg.header.method;
    var service = this._services[srv];
    if (!service) {
        req.rpc_error('NOT_FOUND', srv);
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

            dbg.log1('RPC handle_request: ENTER',
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

            dbg.log1('RPC handle_request: COMPLETED',
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

            // set default internal error if no other error was specified
            if (!req.error) {
                req.rpc_error('INTERNAL', err);
            }

            return conn.send(req.export_response_buffer(), 'res', req);
        });
};


/**
 *
 * handle_response
 *
 */
RPC.prototype.handle_response = function(conn, msg) {
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
    var self = this;
    var address = options.address || self.base_address;
    var addr_url = url.parse(address, true);
    var conn = self._get_connection_by_address(addr_url);
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
 */
RPC.prototype._get_connection_by_address = function(addr_url) {
    var conn = this._connection_by_address[addr_url.href];
    if (conn) {
        dbg.log2('RPC get_connection_by_address: existing', conn.connid);
    } else {
        conn = this._new_connection(addr_url);
        dbg.log1('RPC get_connection_by_address: new', conn.connid);
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
        dbg.log0('RPC CONNECTION', conn.connid, conn.url.href);
        this._connection_by_address[conn.url.href] = conn;
    }
    conn._rpc_req_seq = 1;
    conn._sent_requests = {};
    conn._received_requests = {};
    conn.on('message', this.connection_receive_message.bind(this, conn));
    conn.on('close', this.connection_closed.bind(this, conn));

    // we prefer to let the connection handle it's own errors and decide if to close or not
    // conn.on('error', this.connection_error.bind(this, conn));
};


/**
 *
 */
RPC.prototype.connection_error = function(conn, err) {
    dbg.error('RPC CONNECTION ERROR:', conn.connid, conn.url.href, err.stack || err);
    conn.close();
};

/**
 *
 */
RPC.prototype.connection_closed = function(conn) {
    var self = this;

    if (!conn.quiet) {
        dbg.log0('RPC connection_closed:', conn.connid, new Error().stack);
    }

    // remove from connection pool
    if (!conn.transient && self._connection_by_address[conn.url.href] === conn) {
        delete self._connection_by_address[conn.url.href];
    }

    // reject pending requests
    _.each(conn._sent_requests, function(req) {
        dbg.warn('RPC connection_closed: reject reqid', req.reqid,
            'connid', conn.connid);
        req.import_response_message({
            header: {
                op: 'res',
                reqid: req.reqid,
                error: 'disconnected'
            }
        });
    });
};

/**
 *
 */
RPC.prototype.connection_receive_message = function(conn, msg_buffer) {
    var self = this;

    // we allow to receive also objects that are already in "decoded" message form
    // which is useful by connections that want to produce errors without encoding them.
    // see for example in rpc_http.
    var msg = Buffer.isBuffer(msg_buffer) ?
        RpcRequest.decode_message(msg_buffer) :
        msg_buffer;

    if (!msg || !msg.header) {
        conn.emit('error', new Error('RPC connection_receive_message: BAD MESSAGE ' +
            typeof(msg) + ' ' + (msg ? typeof(msg.header) : '') +
            ' conn ' + conn.connid));
        return;
    }

    dbg.log1('RPC connection_receive_message:',
        'op', msg.header.op,
        'reqid', msg.header.reqid,
        'connid', conn.connid);

    switch (msg.header.op) {
        case 'req':
            return self.handle_request(conn, msg);
        case 'res':
            return self.handle_response(conn, msg);
        default:
            conn.emit('error', new Error('RPC connection_receive_message:' +
                ' BAD MESSAGE OP ' + msg.header.op +
                ' reqid ' + msg.header.reqid +
                ' connid ' + conn.connid));
            break;
    }
};


RPC.prototype.emit_stats = function(name, data) {
    try {
        this.emit(name, data);
    } catch (err) {
        dbg.error('RPC emit_stats: ERROR', err.stack || err);
    }
};


/**
 *
 * start_http_server
 *
 */
RPC.prototype.start_http_server = function(port, secure, logging) {
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
