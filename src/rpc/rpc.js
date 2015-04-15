'use strict';

var _ = require('lodash');
var Q = require('q');
var http = require('http');
var assert = require('assert');
var tv4 = require('tv4');
var dbg = require('noobaa-util/debug_module')(__filename);
var rpc_http = require('./rpc_http');
var rpc_peer = require('./rpc_peer');
var RpcWS = require('./rpc_ws');
var RpcRequest = require('./rpc_request');
var RpcConnection = require('./rpc_connection');
var config = require('../../config.js');
var Stats = require('fast-stats').Stats;

module.exports = RPC;

var VALID_HTTP_METHODS = {
    GET: 1,
    PUT: 1,
    POST: 1,
    DELETE: 1
};

var topStatSize = 60;
var statIntervalPushCounter = 1000;
var statIntervalPrint = 10000;
var collectStats = true;

/**
 *
 * RPC
 *
 */
function RPC() {
    var self = this;
    this._stats = {};
    this._apis = {};
    this._services = {};
    this._conn_cache = {};
    this._request_cache = {};
    this._rpc_ws = new RpcWS(this);
    this._schemas = tv4.freshApi();
    this._schemas.addFormat('date', function(data) {
        var d = new Date(data);
        return isNaN(d.getTime()) ? 'bad date' : null;
    });

    if (collectStats) {
        this.intStat = setInterval(function() {
            try {
                self._handleStats();
            } catch (err) {
                dbg.error('Error running stats', err, err.stack);
            }
        }, statIntervalPushCounter);
        this.intStat.unref();

        this.intPrtStat = setInterval(function() {
            try {
                dbg.info(self._getStats());
            } catch (err) {
                dbg.error('Error running print stats', err, err.stack);
            }
        }, statIntervalPrint);
        this.intPrtStat.unref();
    }
}


/**
 *
 * register_api
 *
 */
RPC.prototype.register_api = function(api) {
    var self = this;

    assert(!self._apis[api.name], 'RPC: api already registered ' + api.name);

    // add all definitions
    _.each(api.definitions, function(schema, name) {
        self._schemas.addSchema('/' + api.name + '/definitions/' + name, schema);
    });

    // add all definitions
    _.each(api.definitions, function(schema, name) {
        self._schemas.addSchema('/' + api.name + '/definitions/' + name, schema);
    });

    // go over the api and check its validity
    _.each(api.methods, function(method_api, method_name) {
        // add the name to the info
        method_api.name = method_name;
        method_api.fullname = '/' + api.name + '/methods/' + method_name;
        method_api.params_schema = method_api.fullname + '/params';
        method_api.reply_schema = method_api.fullname + '/reply';

        self._schemas.addSchema(method_api.params_schema, method_api.params || {});
        self._schemas.addSchema(method_api.reply_schema, method_api.reply || {});
        method_api.params_properties = self._schemas.getSchema(method_api.params_schema).properties;

        assert(method_api.method in VALID_HTTP_METHODS,
            'RPC: unexpected http method: ' +
            method_api.method + ' for ' + method_api.fullname);
    });

    self._apis[api.name] = api;

    return api;
};



/**
 *
 * register_service
 *
 */
RPC.prototype.register_service = function(server, api_name, options) {
    var self = this;
    var api = self._apis[api_name];
    var domain = options.domain || '*';

    assert(api,
        'RPC: no such registered api ' + api_name);

    var service = self._services[api_name];
    if (!service) {
        service = self._services[api_name] = {};
    }

    assert(!service[domain],
        'RPC: service already registered ' + api_name + '-' + domain);

    service[domain] = {
        api: api,
        server: server,
        methods: _.mapValues(api.methods, make_service_method)
    };

    function make_service_method(method_api, method_name) {
        var srv_name =
            '/' + api_name +
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
            handler: service_method_handler
        };

        /**
         * service method handler
         */
        function service_method_handler(req) {
            dbg.log0('RPC START', srv_name);
            var startTime = Date.now();
            self._addStatsCounter('RPC RESPONSE', 1);

            return Q.fcall(function() {

                    // authorize the request
                    if (options.authorize) {
                        return options.authorize(req, method_api);
                    }
                })
                .then(function() {

                    // verify params
                    var params_to_validate = method_api.param_raw ?
                        _.omit(req.rpc_params, method_api.param_raw) :
                        req.rpc_params;
                    self._validate_schema(
                        params_to_validate,
                        method_api.params_schema,
                        'SERVER PARAMS');

                    /**
                     * respond with error
                     * @param statusCode <Number> optional http status code.
                     * @param data <String> the error response data to send
                     * @param reason <Any> a reason for logging only
                     * @return error to be thrown by the caller
                     */
                    req.rpc_error = function(statusCode, data, reason) {
                        if (typeof(statusCode) === 'string') {
                            // shift args if status is missing
                            reason = data;
                            data = statusCode;
                            statusCode = 500;
                        }
                        console.error('RPC FAILED', srv_name,
                            statusCode, data, reason);
                        var err = new Error(reason);
                        err.statusCode = statusCode;
                        err.data = data;
                        return err;
                    };

                    // rest_params and rest_error are DEPRECATED.
                    // keeping for backwards compatability
                    req.rest_params = req.rpc_params;
                    req.rest_error = req.rpc_error;

                    // call the server function
                    return server_func(req);
                })
                .then(function(reply) {

                    // verify reply (if not raw buffer)
                    if (!method_api.reply_raw) {
                        self._validate_schema(reply, method_api.reply_schema, 'SERVER REPLY');
                    }
                    dbg.log0('RPC COMPLETED', srv_name);
                    self._addStatsCounter('RPC RESPONSE', -1);
                    self._addStats('RPC RESP Time', (Date.now() - startTime));
                    return reply;
                })
                .then(null, function(err) {
                    console.error('RPC ERROR', srv_name, err, err.stack);
                    self._addStatsCounter('RPC RESPONSE', -1);
                    self._addStats('RPC RESP Time', (Date.now() - startTime));
                    throw err;
                });
        }
    }
};


/**
 *
 * get_service_method
 *
 * @return object that includes: method_api, handler. see register_service()
 *
 */
RPC.prototype.get_service_method = function(api_name, domain, method_name) {
    domain = domain || '*';
    return this._services[api_name] &&
        this._services[api_name][domain] &&
        this._services[api_name][domain].methods[method_name];
};


/**
 *
 * create_client
 *
 */
RPC.prototype.create_client = function(api_name, default_options) {
    var self = this;
    var api = self._apis[api_name];

    assert(api, 'RPC: no such registered api ' + api_name);

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
    var srv_name =
        '/' + api.name +
        '/' + domain +
        '/' + method_api.name;
    dbg.log0('RPC REQUEST', srv_name);

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

    self._addStatsCounter('RPC REQUEST', 1);

    // verify params (local calls don't need it because server already verifies)
    var params_to_validate = method_api.param_raw ?
        _.omit(params, method_api.param_raw) :
        params;

    self._validate_schema(
        params_to_validate,
        method_api.params_schema,
        'CLIENT PARAMS');

    var req = new RpcRequest(api, method_api, params, options);
    self._request_cache[req.reqid] = req;

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
            if (!method_api.reply_raw) {
                self._validate_schema(reply, method_api.reply_schema, 'CLIENT REPLY');
            }
            return reply;
        })
        .then(null, function(err) {
            req.defer.reject(err);
            throw err;
        })
        .fin(function() {
            delete self._request_cache[req.reqid];
            self._addStatsCounter('RPC REQUEST', -1);
            self._addStats('RPC REQ Time', (Date.now() - startTime));
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



/**
 *
 * _validate_schema
 *
 */
RPC.prototype._validate_schema = function(obj, schema, desc) {
    var result = this._schemas.validateResult(
        obj,
        schema,
        true /*checkRecursive*/ ,
        true /*banUnknownProperties*/
    );

    if (!result.valid) {
        dbg.log0('INVALID SCHEMA', desc, obj);
        result.desc = desc;
        throw result;
    }
};


RPC.prototype._addStatsCounter = function(name, value) {
    if (!collectStats) {
        return;
    }
    var self = this;
    try {
        if (!self._stats[name]) {
            self._stats[name] = {
                stat: new Stats({
                    sampling: true
                }),
                current: 0,
                isSum: true
            };
        }
        self._stats[name].current += value;
        dbg.log3('RPC addStatsVal', name, value);
    } catch (err) {
        dbg.error('Error addStatsVal', name, err, err.stack);
    }
};

RPC.prototype._addStats = function(name, value) {
    if (!collectStats) {
        return;
    }
    var self = this;
    try {
        if (!self._stats[name]) {
            self._stats[name] = {
                stat: new Stats()
            };
        }
        self._stats[name].stat.push(value);

        dbg.log3('RPC addStats', name, value);
    } catch (err) {
        dbg.error('Error addStats', name, err, err.stack);
    }
};

RPC.prototype._handleStats = function() {
    var self = this;

    try {
        _.each(self._stats, function(stats, name) {
            var stat = stats.stat;

            if (stats.isSum) {
                stat.push(stats.current);
            }

            while (stat.length > topStatSize) {
                stat.shift();
            }

        });
    } catch (err) {
        dbg.error('Error addToStat', err, err.stack);
    }
};

RPC.prototype._getStats = function() {
    var self = this;
    var result = 'Statistics: ';
    var name;
    var stat;
    try {
        _.each(self._stats, function(stats, name) {
            stat = stats.stat;
            result += '\nname: ' + name + ' size: ' + stat.length + ' mean: ' + stat.amean().toFixed(2);
            if (stats.isSum) {
                result += ' (aprox last 60 secs) ';
            } else {
                result += ' (aprox last 60 tx) ';
            }
            result += ' median: ' + stat.median().toFixed(2) + ' range: [' + stat.range() + ']';
            if (stats.isSum) {
                result += ' current: ' + stats.current;
            }
        });
    } catch (err) {
        dbg.error('Error getStats', err, err.stack);
    }

    return result;
};
