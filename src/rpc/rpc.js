'use strict';

var _ = require('lodash');
var Q = require('q');
var http = require('http');
var assert = require('assert');
var tv4 = require('tv4');
var dbg = require('noobaa-util/debug_module')(__filename);
var rpc_http = require('./rpc_http');
var rpc_ice = require('./rpc_ice');
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
    this._schemas = tv4.freshApi();
    this._schemas.addFormat('date', function(data) {
        var d = new Date(data);
        return isNaN(d.getTime()) ? 'bad date' : null;
    });

    if (collectStats) {
        this.intStat = setInterval(function(){
            try {
                self.handleStats();
            } catch (err) {
                dbg.error('Error running stats',err,err.stack);
            }
        }, statIntervalPushCounter);

        this.intPrtStat = setInterval(function(){
            try{
                dbg.info(self.getStats());
            } catch (err) {
                dbg.error('Error running print stats',err,err.stack);
            }
        }, statIntervalPrint);
    }
}


RPC.prototype.addStatsCounter = function(name, value) {
    if (!collectStats) {return;}
    var self = this;
    try {
        if (!self._stats[name]) {
            self._stats[name] = {
                stat: new Stats({sampling: true}),
                current: 0,
                isSum: true
            };
        }
        self._stats[name].current += value;
        dbg.log3('RPC addStatsVal',name,value);
    } catch (err) {
        dbg.error('Error addStatsVal',name,err,err.stack);
    }
};

RPC.prototype.addStats = function(name, value) {
    if (!collectStats) {return;}
    var self = this;
    try {
        if (!self._stats[name]) {
            self._stats[name] = {
                stat: new Stats()
            };
        }
        self._stats[name].stat.push(value);

        dbg.log3('RPC addStats',name,value);
    } catch (err) {
        dbg.error('Error addStats',name,err,err.stack);
    }
};

RPC.prototype.handleStats = function() {
    var self = this;
    var name;
    var stat;

    try {
        for (name in self._stats) {
            stat = self._stats[name].stat;

            if (self._stats[name].isSum) {
                stat.push(self._stats[name].current);
            }

            while (stat.length > topStatSize) {
                stat.shift();
            }

        }
    } catch (err) {
        dbg.error('Error addToStat',err,err.stack);
    }
};

RPC.prototype.getStats = function() {
    var self = this;
    var result = 'Statistics: ';
    var name;
    var stat;
    try {
        for (name in self._stats) {
            stat = self._stats[name].stat;
            result += '\nname: '+name+' size: '+stat.length+' mean: '+stat.amean().toFixed(2);
            if (self._stats[name].isSum) {
                result += ' (aprox last 60 secs) ';
            } else {
                result += ' (aprox last 60 tx) ';
            }
            result += ' median: '+stat.median().toFixed(2) + ' range: ['+stat.range()+']';
            if (self._stats[name].isSum) {
                result += ' current: '+self._stats[name].current;
            }
        }
    } catch (err) {
        dbg.error('Error getStats',err,err.stack);
    }

    return result;
};

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
RPC.prototype.register_service = function(server, api_name, domain, options) {
    var self = this;
    var api = self._apis[api_name];
    domain = domain || '';

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
        var srv_name = '/' + api_name + '/' + method_name + '/' + domain;
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

            var startTime = (new Date()).getTime();

            self.addStatsCounter('RPC RESPONSE', 1);

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
                    self.addStatsCounter('RPC RESPONSE', -1);
                    self.addStats('RPC RESP Time', ((new Date()).getTime() - startTime));
                    return reply;
                })
                .then(null, function(err) {
                    console.error('RPC ERROR', srv_name, err, err.stack);
                    self.addStatsCounter('RPC RESPONSE', -1);
                    self.addStats('RPC RESP Time', ((new Date()).getTime() - startTime));
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
RPC.prototype.get_service_method = function(api_name, method_name, domain) {
    domain = domain || '';
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

    var startTime = (new Date()).getTime();

    var srv_name =
        '/' + api.name +
        '/' + method_api.name +
        '/' + options.domain;
    dbg.log0('RPC REQUEST', srv_name);

    // if the service is registered locally,
    // dispatch to simple function call

    var local_method = self.get_service_method(
        api.name, method_api.name, options.domain);

    if (local_method) {
        return local_method.handler({
            auth_token: options.auth_token,
            rpc_params: params
        });
    }

    self.addStatsCounter('RPC REQUEST', 1);

    // verify params (local calls don't need it because server already verifies)
    var params_to_validate = method_api.param_raw ?
        _.omit(params, method_api.param_raw) :
        params;
    self._validate_schema(
        params_to_validate,
        method_api.params_schema,
        'CLIENT PARAMS');

    var timeout = options.timeout || config.default_rpc_timeout; // a default high time
    var retries = options.retries || config.default_rpc_retries;
    var attempts = 0;
    var timed_out = false;
    var transport;

    dbg.log2('RPC attempt at ', method_api, timeout, retries);

    // choose suitable transport
    if (config.use_ws_when_possible && options.is_ws && options.peer) {
        transport = rpc_ice.request_ws;
    } else if (config.use_ice_when_possible && options.peer) {
        transport = rpc_ice.request;
    } else {
        transport = rpc_http.request;
    }
    if (!transport) {
        dbg.log0('RPC: no transport available', srv_name, options);
        throw new Error('RPC: no transport available ' + srv_name);
    }

    // send the request and loop as long as we didn't timeout
    // and attempts below number of retries
    function send_request() {
        attempts += 1;
        dbg.log1('RPC ATTEMPT', attempts, srv_name, params);
        return transport(self, api, method_api, params, options)
            .then(null, function(err) {
                // error with statusCode means we got the reply from the server
                // so there is no point to retry
                if (err && err.statusCode && err.statusCode !== 503) {
                    dbg.log0('RPC REQUEST FAILED', err);
                    throw err;
                }
                if (timed_out) {
                    dbg.log0('RPC REQUEST TIMEOUT', attempts, srv_name);
                    throw err;
                }
                if (attempts >= retries) {
                    dbg.log0('RPC RETRIES EXHAUSTED', attempts, srv_name);
                    throw err;
                }
                dbg.log0('RPC REQUEST FAILED - DO RETRY', err, params);
                return Q.delay(config.rpc_retry_delay).then(send_request);
            });
    }

    return send_request()
        .timeout(timeout)
        .then(null, function(err) {
            // we mark the timeout for the looping request to be able to break
            if (err.code === 'ETIMEDOUT') {
                timed_out = true;
            }
            self.addStatsCounter('RPC REQUEST', -1);
            self.addStats('RPC REQ Time', ((new Date()).getTime() - startTime));
            throw err;
        })
        .then(function(reply) {

            // validate reply
            if (!method_api.reply_raw) {
                self._validate_schema(reply, method_api.reply_schema, 'CLIENT REPLY');
            }
            self.addStatsCounter('RPC REQUEST', -1);
            self.addStats('RPC REQ Time', ((new Date()).getTime() - startTime));
            return reply;
        });
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
