'use strict';

var _ = require('lodash');
var Q = require('q');
var ip = require('ip');
var url = require('url');
var util = require('util');
var assert = require('assert');
var dbg = require('noobaa-util/debug_module')(__filename);
var RpcRequest = require('./rpc_request');
var RpcConnection = require('./rpc_connection');
var EventEmitter = require('events').EventEmitter;

module.exports = RPC;

// allow self generated certificates for testing
// TODO NODE_TLS_REJECT_UNAUTHORIZED is not a proper flag to mess with...
process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

var browser_location = global.window && global.window.location;
var is_browser_secure = browser_location && browser_location.protocol === 'https:';
var is_browser_insecure = browser_location && browser_location.protocol === 'http:';

util.inherits(RPC, EventEmitter);

/**
 *
 * RPC
 *
 */
function RPC() {
    EventEmitter.call(this);
    this._services = {};
    this._connection_pool = {};
}


/**
 *
 * register_service
 *
 */
RPC.prototype.register_service = function(api, server, options) {
    var self = this;
    options = options || {};
    options.peer = options.peer || '*';

    _.each(api.methods, function(method_api, method_name) {
        var srv = '/' + options.peer + '/' + api.name + '/' + method_name;
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
 * create_client
 *
 */
RPC.prototype.create_client = function(api, default_options) {
    var self = this;
    var client = {
        options: default_options || {}
    };
    if (!api || !api.name || !api.methods) {
        throw new Error('RPC create_client: BAD API');
    }

    if (_.isEmpty(client.options.address)) {
        // in the browser we take the address as the host of the web page -
        // just like any ajax request.
        if (browser_location) {
            client.options.address = [
                // ws address
                (is_browser_secure ? 'wss://' : 'ws://') +
                browser_location.host,
                // http address
                browser_location.protocol + '//' +
                browser_location.host
            ];
        } else {
            // set a default for development
            client.options.address = 'ws://localhost:5001';
        }
    }
    parse_options_address(client.options);

    // create client methods
    _.each(api.methods, function(method_api, method_name) {
        client[method_name] = function(params, options) {
            options = _.create(client.options, options);
            parse_options_address(options);
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
    var req = new RpcRequest();

    // initialize the request
    options = options || {};
    req.new_request(api, method_api, params, options);
    req.response_defer = Q.defer();

    dbg.log1('RPC client_request:', req.srv);
    self.emit_stats('stats.client_request.start', req);

    return Q.fcall(function() {
            // verify params (local calls don't need it because server already verifies)
            method_api.validate_params(params, 'CLIENT');

            // assign a connection to the request
            return self.assign_connection(req, options);

        })
        .then(function() {

            dbg.log1('RPC client_request: send',
                req.connection.url.href + req.srv);

            // send request over the connection
            var req_buffer = req.export_request_buffer();
            var send_promise = Q.when(req.connection.send(req_buffer, 'req', req));

            // set timeout to abort if the specific connection/transport
            // can do anything with it, for http this calls req.abort()
            if (options.timeout) {
                send_promise = send_promise.timeout(
                    options.timeout, 'RPC client_request: send TIMEOUT');
            }

            return send_promise;
        })
        .then(function() {

            dbg.log1('RPC client_request: wait response',
                req.connection.url.href + req.srv);

            var reply_promise = req.response_defer.promise;

            if (options.timeout) {
                reply_promise = reply_promise.timeout(
                    options.timeout, 'RPC client_request: response TIMEOUT');
            }

            return reply_promise;

        })
        .then(function(reply) {

            dbg.log1('RPC client_request: response received',
                req.connection.url.href + req.srv);

            // validate reply
            method_api.validate_reply(reply, 'CLIENT');

            self.emit_stats('stats.client_request.done', req);
            return reply;

        })
        .then(null, function(err) {

            dbg.error('RPC client_request: response ERROR',
                req.connection.url.href + req.srv,
                err.stack || err);
            self.emit_stats('stats.client_request.error', req);
            throw err;

        })
        .fin(function() {
            return self.release_connection(req);
        });
};


// order protocol in ascending order of precendence (first is most prefered).
var PROTOCOL_ORDER = [];
PROTOCOL_ORDER.push('fcall:');
if (!browser_location) {
    PROTOCOL_ORDER.push('nudps:');
    PROTOCOL_ORDER.push('nudp:');
}
if (!is_browser_insecure) {
    PROTOCOL_ORDER.push('wss:');
}
if (!is_browser_secure) {
    PROTOCOL_ORDER.push('ws:');
}
if (!is_browser_insecure) {
    PROTOCOL_ORDER.push('https:');
}
if (!is_browser_secure) {
    PROTOCOL_ORDER.push('http:');
}
var PROTOCOL_ORDER_MAP = _.invert(PROTOCOL_ORDER);
var FCALL_ADDRESS = [url.parse('fcall://fcall')];

function address_order(u) {
    return 1000 * (PROTOCOL_ORDER_MAP[u.protocol] || 1000) +
        10 * (ip.isPrivate(u.hostname) ? 0 : 1);
}

function address_sort(u1, u2) {
    return address_order(u1) - address_order(u2);
}

function parse_options_address(options) {
    if (!options.address) {
        return;
    }
    if (!_.isArray(options.address)) {
        options.address = [options.address];
    }
    if (!options.address[0].protocol) {
        options.address = _.map(options.address, function(addr) {
            return addr.protocol ? addr : url.parse(addr);
        });
    }
    options.address.sort(address_sort);
    if (options.last_address) {
        _.pull(options.address, options.last_address);
        options.address.unshift(options.last_address);
    }
    dbg.log1('RPC parse_options_address:', _.map(options.address, 'href'));
}

/**
 *
 * assign_connection
 *
 */
RPC.prototype.assign_connection = function(req, options) {
    var self = this;
    var address = options.address;
    var next_address_index = 0;

    // if the service is registered locally,
    // we can ignore the address in options
    // and dispatch to do function call.
    if (options.allow_fcall && self._services[req.srv]) {
        address = FCALL_ADDRESS;
    }

    return try_next_address();

    function try_next_address() {
        if (next_address_index >= address.length) {
            dbg.error('RPC assign_connection: connect EXHAUSTED', _.map(options.address, 'href'));
            throw new Error('RPC assign_connection: connect EXHAUSTED');
        }
        var address_url = address[next_address_index++];
        if (next_address_index > 1) {
            dbg.log0('RPC assign_connection: try connecting', address_url.href,
                next_address_index + '/' + address.length);
        }
        var conn = self.get_connection(address_url);
        return Q.when(conn.connect(options))
            .then(function() {
                return conn.authenticate(options.auth_token);
            })
            .then(function() {
                req.connection = conn;
                conn.sent_requests[req.reqid] = req;
            }, function(err) {
                dbg.warn('RPC assign_connection: connect ERROR',
                    address_url.href, 'will try next address');
                return try_next_address();
            });
    }
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
RPC.prototype.get_connection = function(address_url) {
    var self = this;
    if (_.isString(address_url)) {
        address_url = url.parse(address_url);
    }
    var conn = self._connection_pool[address_url.href];
    if (conn) {
        dbg.log1('RPC get_connection: reusable connection', address_url.href);
        return conn;
    }
    conn = new RpcConnection(self, address_url);
    if (conn.reusable) {
        self._connection_pool[address_url.href] = conn;
    }
    conn.receive = self.on_connection_receive.bind(self, conn);
    conn.on('close', self.on_connection_close.bind(self, conn));
    conn.on('error', self.on_connection_error.bind(self, conn));
    conn.sent_requests = {};
    conn.received_requests = {};
    return conn;
};

/**
 *
 */
RPC.prototype.on_connection_close = function(conn) {
    var self = this;
    dbg.log0('RPC on_connection_close:', conn.url.href);

    // remove from connection pool
    if (conn.reusable) {
        delete self._connection_pool[conn.url.href];
    }

    // reject pending requests
    _.each(conn.sent_requests, function(req) {
        req.import_response_message({
            header: {
                op: 'res',
                reqid: req.reqid,
                error: 'connection closed'
            }
        });
    });
};

/**
 *
 */
RPC.prototype.on_connection_error = function(conn, err) {
    dbg.error('RPC on_connection_error', conn.url.href, err.stack || err);
    conn.close();
};

/**
 *
 */
RPC.prototype.on_connection_receive = function(conn, msg_buffer) {
    var self = this;
    var msg = Buffer.isBuffer(msg_buffer) ?
        RpcRequest.decode_message(msg_buffer) :
        msg_buffer;
    dbg.log1('RPC on_connection_receive:', conn.url.href, msg);

    if (!msg || !msg.header) {
        conn.emit('error', new Error('RPC on_connection_receive: BAD MESSAGE ' +
            typeof(msg) + ' ' + (msg ? typeof(msg.header) : '') + ' ' + conn.url.href));
        return;
    }

    switch (msg.header.op) {
        case 'req':
            return self.handle_request(conn, msg);
        case 'res':
            return self.handle_response(conn, msg);
        default:
            conn.emit('error', new Error('RPC on_connection_receive: BAD MESSAGE OP ' +
                msg.header.op + ' ' + conn.url.href));
            break;
    }
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
    var srv =
        '/' + msg.header.peer +
        '/' + msg.header.api +
        '/' + msg.header.method;
    var service = this._services[srv];
    if (!service) {
        req.rpc_error('NOT_FOUND', srv);
        return conn.send(req.export_response_buffer(), 'res', req);
    }

    // set api info to the request
    req.import_request_message(msg, service.api, service.method_api);

    dbg.log1('RPC handle_request: START', conn.url.href + req.srv);
    self.emit_stats('stats.handle_request.start', req);

    return Q.fcall(function() {
            // authorize the request
            if (service.options.authorize) {
                return service.options.authorize(req);
            }
        })
        .then(function() {
            req.method_api.validate_params(req.params, 'SERVER');
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

            req.method_api.validate_reply(reply, 'SERVER');
            req.reply = reply;
            dbg.log1('RPC handle_request: COMPLETED', conn.url.href + req.srv);
            self.emit_stats('stats.handle_request.done', req);
            return conn.send(req.export_response_buffer(), 'res', req);
        })
        .then(null, function(err) {

            console.error('RPC handle_request: ERROR', conn.url.href + req.srv, err.stack || err);
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
            msg.header.reqid, conn.url.href);
        // TODO stats?
        return;
    }

    var is_pending = req.import_response_message(msg);
    if (!is_pending) {
        dbg.log0('RPC handle_response: GOT RESPONSE BUT REQUEST NOT PENDING',
            msg.header.reqid, conn.url.href);
        // TODO stats?
    }
};


RPC.prototype.emit_stats = function(name, data) {
    try {
        this.emit(name, data);
    } catch (err) {
        dbg.error('RPC emit_stats: ERROR', err.stack || err);
    }
};
