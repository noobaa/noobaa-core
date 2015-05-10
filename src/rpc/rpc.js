'use strict';

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
var RpcNudpConnection = require('./rpc_nudp');
var RpcFcallConnection = require('./rpc_fcall');
var EventEmitter = require('events').EventEmitter;

module.exports = RPC;

// dbg.set_level(5, __dirname);

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

// allow self generated certificates for testing
// TODO NODE_TLS_REJECT_UNAUTHORIZED is not a proper flag to mess with...
process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;


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
    this._peers = {};

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

    dbg.log1('RPC client_request: START',
        'reqid', req.reqid,
        'srv', req.srv);

    self.emit_stats('stats.client_request.start', req);

    return Q.fcall(function() {

            // assign a connection to the request
            return self.assign_connection(req, options);

        })
        .then(function() {

            // connect the connection
            return Q.invoke(req.connection, 'connect', options);

        })
        .then(function() {

            dbg.log1('RPC client_request: SEND',
                'reqid', req.reqid,
                'srv', req.srv,
                'connid', req.connection.connid);

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
                'reqid', req.reqid,
                'srv', req.srv,
                'connid', req.connection.connid);

            var reply_promise = req.response_defer.promise;

            if (options.timeout) {
                reply_promise = reply_promise.timeout(
                    options.timeout, 'RPC client_request: response TIMEOUT');
            }

            return reply_promise;

        })
        .then(function(reply) {

            dbg.log1('RPC client_request: DONE',
                'reqid', req.reqid,
                'srv', req.srv,
                'connid', req.connection.connid);

            self.emit_stats('stats.client_request.done', req);

            return reply;

        })
        .then(null, function(err) {

            dbg.error('RPC client_request: response ERROR reqid', req.reqid,
                'srv', req.srv, 'connid', req.connection ? req.connection.connid : '',
                err.stack || err);

            self.emit_stats('stats.client_request.error', req);

            throw err;

        })
        .fin(function() {
            return self.release_connection(req);
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
                'reqid', req.reqid,
                'srv', req.srv,
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
            var cached_req = conn.received_requests[req.reqid];
            if (cached_req) {
                return cached_req.server_promise;
            }

            // insert to requests map and process using the server func
            conn.received_requests[req.reqid] = req;
            req.server_promise = Q.fcall(service.server_func, req)
                .fin(function() {
                    // TODO keep received requests for some time after with LRU?
                    delete conn.received_requests[req.reqid];
                });

            return req.server_promise;

        })
        .then(function(reply) {

            req.reply = reply;

            dbg.log1('RPC handle_request: COMPLETED',
                'reqid', req.reqid,
                'srv', req.srv,
                'connid', conn.connid);
            self.emit_stats('stats.handle_request.done', req);

            return conn.send(req.export_response_buffer(), 'res', req);

        })
        .then(null, function(err) {

            console.error('RPC handle_request: ERROR',
                'reqid', req.reqid,
                'srv', req.srv,
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
    var req = conn.sent_requests[msg.header.reqid];
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
    }
};



/**
 *
 * assign_connection
 *
 */
RPC.prototype.assign_connection = function(req, options) {
    var self = this;
    var address = options.address || self.base_address;
    var conn = self.get_connection_by_address(address);
    var reqid = req.reqid = conn.rpc_reqid_seq || 1;
    conn.rpc_reqid_seq = reqid + 1;
    conn.sent_requests[reqid] = req;
    req.connection = conn;
    return conn;
};

/**
 *
 * release_connection
 *
 */
RPC.prototype.release_connection = function(req) {
    if (req.connection) {
        delete req.connection.sent_requests[req.reqid];
    }
};

/**
 *
 */
RPC.prototype.get_connection_by_address = function(address) {
    var conn = this._connection_by_address[address];
    if (conn) {
        dbg.log1('RPC get_connection_by_address: existing', conn.connid);
    } else {
        conn = this.new_connection(address);
        dbg.log1('RPC get_connection_by_address: new', conn.connid);
    }
    return conn;
};

/**
 *
 */
RPC.prototype.new_connection = function(address) {
    var conn;
    var address_url = url.parse(address);
    // always replace previous connection in the address map,
    // assuming the new connection is preferred.
    switch (address_url.protocol) {
        case 'ws:':
        case 'wss:':
            conn = new RpcWsConnection(address_url);
            break;
        case 'nudp:':
            conn = new RpcNudpConnection(address_url);
            break;
        case 'http:':
        case 'https:':
            conn = new RpcHttpConnection(address_url);
            break;
        case 'fcall:':
            conn = new RpcFcallConnection(address_url);
            break;
        default:
            throw new Error('RPC new_connection: bad protocol ' + address);
    }
    this.accept_new_connection(conn);
    return conn;
};


/**
 *
 */
RPC.prototype.accept_new_connection = function(conn) {
    if (!conn.singleplex) {
        // http connections are opened per request ad not saved
        // since they are not really connections but rather just a single req-res.
        this._connection_by_address[conn.url.href] = conn;
    }
    conn.sent_requests = {};
    conn.received_requests = {};
    conn.on('message', this.connection_receive_message.bind(this, conn));
    conn.on('close', this.connection_closed.bind(this, conn));
    // conn.on('error', this.connection_error.bind(this, conn));
};


/**
 *
 */
RPC.prototype.connection_closed = function(conn) {
    var self = this;
    dbg.log0('RPC connection_closed:', conn.connid);

    // remove from connection pool
    if (!conn.singleplex && self._connection_by_address[conn.url.href] === conn) {
        delete self._connection_by_address[conn.url.href];
    }

    // reject pending requests
    _.each(conn.sent_requests, function(req) {
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
                ' conn ' + conn.connid));
            break;
    }
};


/**
 *
 */
RPC.prototype.connection_send_signal = function(conn, message) {
    if (this.send_signal) {
        dbg.log0('RPC connection_send_signal', conn.peer, conn.connid, message);
        this.send_signal({
            target: {
                id: 'unused',
                peer: conn.peer,
                address: conn.url.href,
            },
            info: {
                conn_time: conn.time,
                conn_rand: conn.rand,
                message: message,
            }
        });
    }
};


/**
 *
 */
RPC.prototype.receive_signal = function(params) {
    var conn = this.get_connection_by_id(
        params.target.address,
        params.info.conn_time,
        params.info.conn_rand,
        true);
    // TODO if this connection is new but will not connect we should cleanup
    return conn.receive_signal(params.info.message, this.signal_socket);
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
    http_server.on('connection', this.accept_new_connection.bind(this));
    return http_server.start(port, secure, logging);
};


/**
 *
 * register_http_transport
 *
 */
RPC.prototype.register_http_transport = function(express_app) {
    var http_server = new RpcHttpConnection.Server();
    http_server.on('connection', this.accept_new_connection.bind(this));
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
    ws_server.on('connection', this.accept_new_connection.bind(this));
    return ws_server;
};


/**
 *
 * register_nudp_transport
 *
 */
RPC.prototype.register_nudp_transport = function(port) {
    var nudp_server = new RpcNudpConnection.Server(port);
    nudp_server.on('connection', this.accept_new_connection.bind(this));
    return nudp_server;
};
