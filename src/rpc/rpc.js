'use strict';

var _ = require('lodash');
var Q = require('q');
var http = require('http');
var util = require('util');
var assert = require('assert');
var dbg = require('noobaa-util/debug_module')(__filename);
var rpc_http = require('./rpc_http');
var rpc_peer = require('./rpc_peer');
var RpcWS = require('./rpc_ws');
var RpcRequest = require('./rpc_request');
var RpcConnection = require('./rpc_connection');
var config = require('../../config.js');
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
    this._conn_cache = {};
    this._sent_requests = {};
    this._received_requests = {};
    // this._rpc_ws = new RpcWS(this);
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
 * handle_request
 *
 */
RPC.prototype.handle_request = function(req_info) {
    var self = this;
    var req = new RpcRequest();

    // resolve the api and method of the request
    var service = self._services[req_info.api];
    if (!service) {
        req.import_request(req_info);
        req.set_error('NOT_FOUND',
            'api ' + req_info.api);
        return req.export_response();
    }

    var domain_service = service[req_info.domain];
    if (!domain_service) {
        req.import_request(req_info);
        req.set_error('NOT_FOUND',
            'domain /' + req_info.api + '/' + req_info.domain);
        return req.export_response();
    }

    var method = domain_service.methods[req_info.method];
    if (!method) {
        req.import_request(req_info);
        req.set_error('NOT_FOUND',
            'method /' + req_info.api + '/' + req_info.domain + '/' + req_info.method);
        return req.export_response();
    }

    // set api info to the request
    req.import_request(req_info, service.api, method.method_api);

    dbg.log1('RPC START', req.srv);
    self.emit('req.received.start', {
        name: req.srv
    });

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
            self.emit('req.received.done', {
                name: req.srv,
                time: Date.now() - req.time
            });
            req.set_reply(reply);
            return req.export_response();
        })
        .then(null, function(err) {
            console.error('RPC ERROR', req.srv, err.stack || err);
            self.emit('req.received.error', {
                name: req.srv,
                time: Date.now() - req.time
            });

            // set default internal error if no other error was specified
            req.set_error('INTERNAL', err);
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
            return self.make_request(api, method_api, params, options);
        };
    });

    return client;
};



/**
 *
 * make_request
 *
 */
RPC.prototype.make_request = function(api, method_api, params, options) {
    var self = this;
    var req = new RpcRequest();
    req.new_request(api, method_api, params, options);
    dbg.log1('RPC REQUEST', req.srv);

    // if the service is registered locally,
    // dispatch to function call.
    // handle_request will validate params so skip here
    if (self.is_local_service_domain(api.name, req.domain)) {
        return self.make_request_local(req);
    }

    self.emit('req.send.start', {
        name: req.srv,
    });

    self._sent_requests[req.reqid] = req;

    return Q.fcall(function() {
            // verify params (local calls don't need it because server already verifies)
            method_api.validate_params(params, 'CLIENT');
            return self.make_connection(req);
        })
        .then(function(conn) {
            return conn.send_request(req);
        })
        .then(function() {
            return req.defer.promise;
        })
        .then(function(reply) {
            // validate reply
            method_api.validate_reply(reply, 'CLIENT');
            self.emit('req.done', {
                name: req.srv,
                time: Date.now() - req.time
            });
            return reply;
        })
        .then(null, function(err) {
            self.emit('req.error', {
                name: req.srv,
                time: Date.now() - req.time
            });
            req.defer.reject(err);
            throw err;
        })
        .fin(function() {
            delete self._sent_requests[req.reqid];
        });
};


/**
 *
 * _connect
 *
 */
RPC.prototype.make_connection = function(req) {
    var domain = req.options.domain || '*';
    var conn = this._conn_cache[domain];
    if (!conn) {
        conn = this._conn_cache[domain] = new RpcConnection(domain);
    }
    return conn.connect();
};


RPC.prototype.is_local_service_domain = function(api_name, domain) {
    return this._services[api_name] && this._services[api_name][domain];
};

RPC.prototype.make_request_local = function(req) {
    var self = this;

    self.emit('req.send.local', {
        name: req.srv,
    });

    req.promise = Q.fcall(function() {
            return self.handle_request(req.export_request());
        })
        .then(function(res) {
            req.import_response(res);
            return req.defer.promise;
        });

    return req.promise;
};
