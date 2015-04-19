'use strict';

var _ = require('lodash');
var Q = require('q');
var util = require('util');
var assert = require('assert');
var dbg = require('noobaa-util/debug_module')(__filename);
var RpcRequest = require('./rpc_request');
var RpcConnection = require('./rpc_connection');
var EventEmitter = require('events').EventEmitter;

module.exports = RPC;

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
    this._sent_requests = {};
    this._received_requests = {};
}


/**
 *
 * register_service
 *
 */
RPC.prototype.register_service = function(api, server, options) {
    var self = this;
    options = options || {};
    var domain = options.domain || '*';

    var service = self._services[api.name];
    if (!service) {
        service = self._services[api.name] = {};
    }

    assert(!service[domain],
        'RPC: service already registered ' + api.name + '-' + domain);

    service[domain] = {
        api: api,
        server: server,
        options: options,
        methods: _.mapValues(api.methods, function(method_api, method_name) {
            var func = server[method_name];
            if (!func && options.allow_missing_methods) {
                func = function() {
                    return Q.reject({
                        data: 'RPC: missing method implementation - ' + method_api.fullname
                    });
                };
            }
            assert.strictEqual(typeof(func), 'function',
                'RPC: server method should be a function - ' + method_api.fullname);
            return {
                method_api: method_api,
                server_func: func.bind(server),
            };
        })
    };
};


/**
 *
 * create_client
 *
 */
RPC.prototype.create_client = function(api, default_options) {
    var self = this;
    var client = {};
    if (!api || !api.name || !api.methods) {
        throw new Error('BAD API on RPC.create_client');
    }

    // create client methods
    _.each(api.methods, function(method_api, method_name) {
        client[method_name] = function(params, options) {
            // fill default options from client
            options = options || {};
            _.forIn(default_options, function(v, k) {
                if (!(k in options)) {
                    options[k] = v;
                }
            });
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

    self._sent_requests[req.reqid] = req;

    dbg.log1('RPC REQUEST', req.srv);
    self.emit_stats('stats.client_request.start', req);

    return Q.fcall(function() {

            // verify params (local calls don't need it because server already verifies)
            method_api.validate_params(params, 'CLIENT');

            // assign a connection to the request
            return self.assign_connection(req, options);

        })
        .then(function() {

            dbg.log1('RPC REQUEST SEND', req.srv);

            // send request over the connection
            var msg = req.export_message();
            var msg_buffer = RpcRequest.encode_message(msg);
            var send_promise = req.connection.send(msg_buffer, 'req');

            // set timeout to abort if the specific connection/transport
            // can do anything with it, for http this calls req.abort()
            if (options.timeout) {
                send_promise = send_promise.timeout(
                    options.timeout, 'RPC SEND REQUEST TIMEOUT');
            }

            return send_promise;
        })
        .then(function() {

            dbg.log1('RPC RESPONSE WAIT', req.srv);

            var reply_promise = req.response_defer.promise;

            if (options.timeout) {
                reply_promise = reply_promise.timeout(
                    options.timeout, 'RPC WAIT RESPONSE TIMEOUT');
            }

            return reply_promise;

        })
        .then(function(reply) {

            dbg.log0('RPC RESPONSE RECEIVED', req.srv);

            // validate reply
            method_api.validate_reply(reply, 'CLIENT');

            self.emit_stats('stats.client_request.done', req);
            return reply;

        })
        .then(null, function(err) {

            dbg.error('RPC ERROR RECEIVED', req.srv, err.stack || err);
            self.emit_stats('stats.client_request.error', req);
            throw err;

        })
        .fin(function() {

            // TODO leave sent requests in cache for some time?
            delete self._sent_requests[req.reqid];

            // TODO add ref/unref to connection?
            // req.connection.unref();
        });
};


/**
 *
 */
RPC.prototype.is_local_service_domain = function(api_name, domain) {
    return this._services[api_name] && this._services[api_name][domain];
};

/**
 *
 * assign_connection
 *
 */
RPC.prototype.assign_connection = function(req, options) {
    var self = this;
    var address = options.address;

    // if the service is registered locally,
    // dispatch to localrpc to do function call.
    if (self.is_local_service_domain(req.api.name, req.domain)) {
        address = 'localrpc://localhost';
    }

    var conn = self._connection_pool[address];
    if (!conn) {
        conn = self.new_connection(address);
    }
    req.connection = conn;
    return conn.connect()
        .then(function() {
            return conn.authenticate(options.auth_token);
        });
};

/**
 *
 */
RPC.prototype.new_connection = function(address) {
    var self = this;
    var conn = new RpcConnection(address);
    if (conn.reusable) {
        self._connection_pool[conn.address] = conn;
    }
    conn.on('close', self.on_connection_close.bind(self, conn));
    conn.on('error', self.on_connection_error.bind(self, conn));
    conn.on('message', self.on_connection_message.bind(self, conn));
    return conn;
};

/**
 *
 */
RPC.prototype.on_connection_close = function(conn) {
    var self = this;
    dbg.log0('CONNECTION CLOSED', conn.address);

    // remove from connection pool
    if (conn.reusable) {
        delete self._connection_pool[conn.address];
    }

    // TODO reject pending requests
};

/**
 *
 */
RPC.prototype.on_connection_error = function(conn, err) {
    // var self = this;
    // TODO reject errored requests
};

/**
 *
 */
RPC.prototype.on_connection_message = function(conn, msg_buffer) {
    var self = this;
    var msg = RpcRequest.decode_message(msg_buffer);
    switch (msg.op) {
        case 'req':
            self.handle_request(conn, msg);
            break;
        case 'res':
            self.handle_response(conn, msg);
            break;
        default:
            dbg.log0('BAD MESSAGE OP', msg.op, msg.reqid);
            // TODO close connection?
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

    // resolve the api and method of the request
    var service = self._services[msg.api];
    if (!service) {
        req.import_request(msg);
        req.rpc_error('NOT_FOUND',
            'api ' + msg.api);

        return req.export_response();
    }

    var domain_service = service[msg.domain];
    if (!domain_service) {
        req.import_request(msg);
        req.rpc_error('NOT_FOUND',
            'domain /' + msg.api + '/' + msg.domain);
        return req.export_response();
    }

    var method = domain_service.methods[msg.method];
    if (!method) {
        req.import_request(msg);
        req.rpc_error('NOT_FOUND',
            'method /' + msg.api + '/' + msg.domain + '/' + msg.method);
        return req.export_response();
    }

    // set api info to the request
    req.import_message(msg, service.api, method.method_api);

    dbg.log1('RPC START', req.srv);
    self.emit_stats('stats.handle_request.start', req);

    // check if this request was already received and served,
    // and if so then join the requests promise so that it will try
    // not to call the server more than once.
    var cached_req = self._received_requests[req.reqid];
    if (cached_req) {
        return cached_req.promise;
    }

    // insert to requests map and process using the server func
    self._received_requests[req.reqid] = req;
    req.promise = Q.fcall(function() {
            // authorize the request
            if (domain_service.options.authorize) {
                return domain_service.options.authorize(req);
            }
        })
        .then(function() {
            req.method_api.validate_params(req.params, 'SERVER');
            return method.server_func(req);
        })
        .then(function(reply) {

            req.method_api.validate_reply(reply, 'SERVER');
            dbg.log1('RPC COMPLETED', req.srv);
            self.emit_stats('stats.handle_request.done', req);
            return reply;
        })
        .then(null, function(err) {

            console.error('RPC ERROR', req.srv, err.stack || err);
            self.emit_stats('stats.handle_request.error', req);

            // set default internal error if no other error was specified
            req.rpc_error('INTERNAL', err);
            return req.export_response();
        })
        .fin(function() {

            // TODO keep received requests for some time after with LRU?
            setTimeout(function() {
                delete self._received_requests[req.reqid];
            }, 1000);
        });

    return req.promise;
};


/**
 *
 * handle_response
 *
 */
RPC.prototype.handle_response = function(conn, msg) {
    var res = msg.header; // TODO
    var req = this._sent_requests[res.reqid];
    if (!req) {
        dbg.log0('GOT RESPONSE BUT NO REQUEST', res.reqid);
        // TODO stats?
        return;
    }

    var already_done = req.set_response(res);
    if (already_done) {
        dbg.log0('GOT RESPONSE BUT REQUEST ALREADY DONE', res.reqid);
        // TODO stats?
    }
};


RPC.prototype.emit_stats = function(name, data) {
    try {
        this.emit(name, data);
    } catch(err) {
        dbg.error('EMIT STATS ERROR', err.stack || err);
    }
};
