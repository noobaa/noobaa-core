'use strict';

var _ = require('lodash');
var Q = require('q');
var http = require('http');
var util = require('util');
var assert = require('assert');
var tv4 = require('tv4');
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

var VALID_HTTP_METHODS = {
    GET: 1,
    PUT: 1,
    POST: 1,
    DELETE: 1
};


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
    this._rpc_ws = new RpcWS(this);
}


/**
 *
 * register_service
 *
 */
RPC.prototype.register_service = function(server, api, options) {
    var self = this;
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
        methods: _.mapValues(api.methods, make_service_method)
    };

    function make_service_method(method_api, method_name) {
        var rpc_srv =
            '/' + api.name +
            '/' + domain +
            '/' + method_name;
        var server_func = server[method_name];
        if (!server_func && options.allow_missing_methods) {
            server_func = function() {
                return Q.reject({
                    data: 'RPC: missing method implementation - ' + method_api.fullname
                });
            };
        }
        assert.strictEqual(typeof(server_func), 'function',
            'RPC: server method should be a function - ' + method_api.fullname);
        server_func = server_func.bind(server);

        return {
            method_api: method_api,
            server_func: server_func,
        };
    }
};


/**
 *
 * handle_request
 *
 */
RPC.prototype.handle_request = function(req_info) {
    var self = this;
    var req = new RpcRequest();
    var service;
    var domain_service;
    var method;

    return Q.fcall(function() {

            // resolve the method of the request
            service = self._services[req_info.api];
            if (!service) {
                req.error('NOT_FOUND', '/' + req_info.api);
            }
            domain_service = service[req_info.domain];
            if (!domain_service) {
                req.error('NOT_FOUND',
                    '/' + req_info.api + '/' + req_info.domain);
            }
            method = domain_service.methods[req_info.method];
            if (!method) {
                req.error('NOT_FOUND',
                    '/' + req_info.api + '/' + req_info.domain + '/' + req_info.method);
            }

            // load the info into the request
            req.import_request(req_info, service.api, method.method_api);

            dbg.log0('RPC START', req.srv);
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
                        return domain_service.options.authorize(req, method.method_api);
                    }
                })
                .then(function() {
                    method.method_api.validate_params(req.params, 'SERVER');
                    return method.server_func(req);
                });
            return req.promise;
        })
        .then(function(reply) {
            method.method_api.validate_reply(reply, 'SERVER');
            dbg.log0('RPC COMPLETED', req.srv);
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

            // TODO maybe delay the removal for some time with LRU
            delete self._received_requests[req.reqid];
        });
};


/**
 *
 * create_client
 *
 */
RPC.prototype.create_client = function(api, default_options) {
    var self = this;
    var client = {};

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
            return self._request(api, method_api, params, options);
        };
    });

    return client;
};



/**
 *
 * _request
 *
 */
RPC.prototype._request = function(api, method_api, params, options) {
    var self = this;
    var domain = options.domain || '*';
    var startTime = Date.now();
    var rpc_srv =
        '/' + api.name +
        '/' + domain +
        '/' + method_api.name;
    dbg.log0('RPC REQUEST', rpc_srv);

    // if the service is registered locally,
    // dispatch to simple function call

    var local_method = self.get_service_method(
        api.name, domain, method_api.name);

    if (local_method) {
        return local_method.handler({
            auth_token: options.auth_token,
            rpc_params: params
        });
    }

    self.emit('req.send', {
        name: rpc_srv,
    });

    // verify params (local calls don't need it because server already verifies)
    method_api.validate_params(params, 'CLIENT');

    var req = new RpcRequest(api, method_api, params, options);
    self._sent_requests[req.reqid] = req;

    return Q.fcall(function() {
            return self._connect(req);
        })
        .then(function(conn) {
            return conn.send_request(req);
        })
        .then(function() {
            return req.promise;
        })
        .then(function(reply) {
            // validate reply
            method_api.validate_reply(reply, 'CLIENT');
            self.emit('req.done', {
                name: rpc_srv,
                time: Date.now() - startTime
            });
            return reply;
        })
        .then(null, function(err) {
            self.emit('req.error', {
                name: rpc_srv,
                time: Date.now() - startTime
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
RPC.prototype._connect = function(req) {
    var domain = req.options.domain || '*';
    var conn = this._conn_cache[domain];
    if (!conn) {
        conn = this._conn_cache[domain] = new RpcConnection(domain);
    }
    return conn.connect();
};
