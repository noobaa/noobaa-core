// module targets: nodejs & browserify
'use strict';

var http = require('http');
var https = require('https');
var querystring = require('querystring');
var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var URL = require('url');
var Cookie = require('cookie-jar');
var tv4 = require('tv4').freshApi();
var ice_api = require('./ice_api');
var buf = require('./buffer_utils');
var dbg = require('./dbg')(__filename);
var config = require('../../config.js');

dbg.log_level = config.dbg_log_level;

module.exports = rest_api;

var PATH_ITEM_RE = /^\S*$/;
var VALID_METHODS = {
    GET: 1,
    PUT: 1,
    POST: 1,
    DELETE: 1
};


/**
 *
 * REST_API
 *
 * initialize the api structure.
 *
 * api (Object):
 * - each key is func_name (String)
 * - each value is func_info (Object):
 *   - method (String) - http method GET/POST/...
 *   - path (Function) - function(params) that returns the path (String) for the call
 *   - data (Function) - function(params) that returns the data (String|Buffer) for the call
 *
 */
function rest_api(api) {
    // increase the maximum sockets per host, the default is 5 which is very low
    if (http.globalAgent && http.globalAgent.maxSockets < 100) {
        http.globalAgent.maxSockets = 100;
    }
    // same for http-browserify
    if (http.Agent && http.Agent.defaultMaxSockets < 100) {
        http.Agent.defaultMaxSockets = 100;
    }

    var api_path = url_path_join('/api', api.name);

    // add all definitions
    _.each(api.definitions, function(schema, name) {
        tv4.addSchema('/' + api.name + '/definitions/' + name, schema);
    });

    // go over the api and check its validity
    var method_and_path_collide = {};
    _.each(api.methods, function(func_info, func_name) {
        // add the name to the info
        func_info.name = func_name;
        func_info.fullname = '/' + api.name + '/methods/' + func_name;
        func_info.params_schema = func_info.fullname + '/params';
        func_info.reply_schema = func_info.fullname + '/reply';

        tv4.addSchema(func_info.params_schema, func_info.params || {});
        tv4.addSchema(func_info.reply_schema, func_info.reply || {});
        func_info.params_properties = tv4.getSchema(func_info.params_schema).properties;

        assert(func_info.method in VALID_METHODS,
            'rest_api: unexpected http method: ' +
            func_info.method + ' for ' + func_info.fullname);

        assert.strictEqual(typeof(func_info.path), 'string',
            'rest_api: unexpected path type: ' +
            func_info.path + ' for ' + func_info.fullname);

        // split the path to its items
        func_info.path_items = _.map(func_info.path.split('/'), function(p) {
            assert(PATH_ITEM_RE.test(p),
                'rest_api: invalid path item: ' + p + ' for ' + func_info.fullname);

            // if a normal path item, just return the string
            if (p[0] !== ':') {
                return p;
            }
            // if a param item (starts with colon) find the param info
            p = p.slice(1);
            var param = func_info.params_properties[p];
            assert(param, 'rest_api: missing param info: ' + p + ' for ' + func_info.fullname);
            return {
                name: p,
                param: param
            };
        });

        // test for colliding method+path
        var method_and_path = func_info.method + func_info.path;
        var collision = method_and_path_collide[method_and_path];
        assert(!collision, 'rest_api: collision of method+path: ' +
            func_info.name + ' ~ ' + collision);
        method_and_path_collide[method_and_path] = func_info.name;
    });

    // add the client and server classes to the api object
    api.Client = Client;
    api.Server = Server;



    // SERVER /////////////////////////////////////////////////////////////////


    /**
     *
     * SERVER
     *
     * server class for the api.
     *
     * methods (Object): map of function names to function(params).
     *
     * options (Object):
     * - allow_missing_methods (String):
     *    call with allow_missing_methods==='allow_missing_methods' to make the server
     *    accept missing functions, the handler for missing functions will fail on runtime.
     *    useful for test servers.
     */
    function Server(methods, options) {
        var self = this;
        options = options || {};
        if (options.allow_missing_methods) {
            assert.strictEqual(options.allow_missing_methods, 'allow_missing_methods');
        }
        self._impl = {};
        self._handlers = {};
        self._log = console.log.bind(console);

        _.each(api.methods, function(func_info, func_name) {
            var func = methods[func_name];
            if (!func && options.allow_missing_methods) {
                func = function(params) {
                    return Q.reject({
                        data: 'rest_api: missing method implementation - ' + func_info.fullname
                    });
                };
            }
            assert.strictEqual(typeof func, 'function',
                'rest_api: server method should be a function - ' + func_info.fullname);
            self._impl[func_name] = func;
            self._handlers[func_name] = self._create_server_handler(func, func_info);
        });
    }

    /**
     * install the server handlers to the given router.
     *
     * router (Object) - express/connect style app router with the following functions:
     * - get,post,put,delete which are function(path, handler).
     *
     * path (String) - optional base path for the routes.
     */
    Server.prototype.install_rest = function(router, path) {

        var self = this;
        path = path || api_path;
        var doc_base = url_path_join('/doc', path);

        // install methods on the router
        _.each(api.methods, function(func_info, func_name) {
            var method_path = url_path_join(path, func_info.path);

            var handler = self._handlers[func_name];
            // route_func points to the route functions router.get/post/put/delete
            var route_func = router[func_info.method.toLowerCase()];
            // call the route function to set the route handler
            route_func.call(router, method_path, handler);



            // install also a documentation route
            router.get(url_path_join(doc_base, func_name), function(req, res) {
                res.send(func_info.doc);
                // TODO restul doc should return also params/reply/other-info doc
            });
        });
    };

    /**
     * call to bypass the server routes.
     * since express middlewares cannot be removed this allows to "remove" them.
     * used for testing where we want to reuse the express app but test different scenarios.
     */
    Server.prototype.disable_rest = function() {
        this._disabled = true;
    };

    /**
     * replace the server logger.
     * logger (Object) is expected to have functions like the console object (log, error, etc).
     */
    Server.prototype.set_logger = function(logger) {
        this._log = logger;
    };

    /**
     * directly call a server func with the given request.
     */
    Server.prototype.call_rest_func = function(func_name, req) {
        return this._impl[func_name](req);
    };

    Server.prototype.ice_server_handler = function(channel, message) {
        if (!this.ice_router) {
            try {
                var express = require('express');
                this.ice_router = express.Router();
                this.install_rest(this.ice_router);
            } catch (ex) {
                console.error('do express ice router ex '+ex);
            }
        }

        var msg;
        var body;
        var reqId;
        var isWs = false;

        if (typeof message === 'string' || message instanceof String) {
            msg = JSON.parse(message);
            reqId = msg.req || msg.requestId;
            body = msg.body;
            dbg.log0('ice do something '+require("util").inspect(msg));
        }  else if (message instanceof ArrayBuffer) {
            try {
                reqId = (buf.toBuffer(message.slice(0,32)).readInt32LE(0)).toString();
            } catch (ex) {
                console.error('problem reading req id rest_api '+ex);
            }
            var msgObj = channel.msgs[reqId];
            body = msgObj.buffer;
            msg = msgObj.peer_msg;
            dbg.log0('ice do something with buffer '+require("util").inspect(msg)+' for req '+reqId);
        } else if (message.method) {
            msg = message;
            body = msg.body;
            reqId = msg.req || msg.requestId;
            dbg.log0('ice do something json '+require("util").inspect(message)+' req '+reqId);
        }
        else {
            console.error('ice got weird msg '+require("util").inspect(message));
        }

        if (msg.sigType) {
            isWs = true;
        }

        var reqBody = body;
        if (body && body.body) {
            reqBody = body.body;

            try {
                if (typeof reqBody === 'string' || reqBody instanceof String) {
                    reqBody = JSON.parse(reqBody);
                }
            } catch (ex) {
                console.error('problem parsing body as json '+ex+' req '+reqId);
            }
        }

        var req = {
            url: 'http://127.0.0.1'+(msg.path || body.path),
            method: msg.method,
            body: reqBody,
            load_auth: function() {} // TODO
        };

        var status;
        var replyJSON;
        var replyBuffer;
        var res = {
            manual: function() {

                try {
                    if (replyBuffer && !(replyBuffer instanceof ArrayBuffer)) {
                        replyBuffer = buf.toArrayBuffer(replyBuffer);
                    }

                    dbg.log0('done manual status: '+status+" reply: "+replyJSON + ' buffer: '+ (replyBuffer ? replyBuffer.byteLength : 0)+' req '+reqId);

                    var reply = {
                        status: status,
                        size: (replyBuffer ? replyBuffer.byteLength : 0),
                        data: replyJSON,
                        req: reqId
                    };

                    if (isWs) {
                        reply.sigType = 'response';
                        reply.requestId = reqId;
                        reply.from = msg.to;
                        reply.to = msg.from;
                    }

                    channel.send(JSON.stringify(reply));

                    if (replyBuffer) {
                        ice_api.writeBufferToSocket(channel, replyBuffer, reqId);
                    }
                } catch (ex) {
                    console.error('ERROR sending ice response '+ex+' req '+reqId);
                }

            },
            status: function(code) {
                status = code;
                return this;
            },
            json: function(msg) {
                replyJSON = msg;
                return this;
            },
            send: function(buffer) {
                replyBuffer = buffer;
                return this;
            }
        };

        this.ice_router.handle(req, res, function(err) {
            console.error('SHOULD NOT BE HERE done status: '+status+" reply: "+replyJSON+" replyBuffer: "+replyBuffer+' if err '+err+' req '+reqId);
        });

    };



    /**
     * return a route handler that calls the server function
     */
    Server.prototype._create_server_handler = function(func, func_info) {
        var self = this;
        return function(req, res, next) {

            // marking _disabled on the server will bypass all the routes it has.
            if (self._disabled) {
                return next();
            }
            Q.fcall(function() {
                /**
                 * mark the request to respond with error
                 * @param status <Number> optional status code.
                 * @param data <String> the error response data to send
                 * @param reason <Any> a reason for logging only
                 */
                req.rest_error = function(status, data, reason) {
                    if (typeof status === 'string') {
                        reason = data;
                        data = status;
                        status = 500;
                    }
                    if (!req._rest_error_data) {
                        req._rest_error_status = status;
                        req._rest_error_data = data;
                        req._rest_error_reason = reason;
                    }
                    return new Error('rest_error');
                };
                req.rest_clear_error = function() {
                    req._rest_error_status = undefined;
                    req._rest_error_data = undefined;
                    req._rest_error_reason = undefined;
                };
                req.rest_params = {};
                _.each(req.query, function(v, k) {
                    req.rest_params[k] =
                        component_to_param(v, func_info.params_properties[k].type);
                });
                if (!func_info.param_raw) {
                    _.each(req.body, function(v, k) {
                        req.rest_params[k] = v;
                    });
                }
                _.each(req.params, function(v, k) {
                    req.rest_params[k] =
                        component_to_param(v, func_info.params_properties[k].type);
                });
                validate_schema(req.rest_params, func_info.params_schema, func_info, 'server request');
                if (func_info.param_raw) {
                    req.rest_params[func_info.param_raw] = req.body;
                }
                if (func_info.auth !== false) {
                    return req.load_auth(func_info.auth);
                }
            })
                .then(function() {
                    // server functions are expected to return a promise
                    return func(req, res, next);
                })
                .then(function(reply) {

                    if (req._rest_error_data) {
                        throw new Error('rethrow_rest_error');
                    }
                    console.error('SERVER COMPLETED', func_info.name);
                    if (func_info.reply_raw) {
                        return res.status(200).send(reply);
                    } else {
                        validate_schema(reply, func_info.reply_schema, func_info, 'server reply');
                        return res.status(200).json(reply);
                    }
                })
                .then(null, function(err) {
                    console.error('SERVER ERROR', func_info.name,
                        ':', req._rest_error_status, req._rest_error_data,
                        '-', req._rest_error_reason);
                    console.error(err.stack || err);
                    var status = req._rest_error_status || err.status || err.statusCode;
                    if (typeof status !== 'number' || status < 100 || status >= 600) {
                        status = 500;
                    }
                    var data = req._rest_error_data || 'error';
                    return res.status(status).json(data);
                })
                .then(function(){
                    if (res.manual) {
                        res.manual();
                    }
                })
                .done(null, function(err) {
                    console.error('SERVER ERROR WHILE SENDING ERROR', func_info.name, ':', err, err.stack);
                    return next(err);
                });
        };
    };



    // CLIENT /////////////////////////////////////////////////////////////////


    /**
     *
     * CLIENT
     *
     * client class for the api.
     *
     * for docs on options & headers see rest_api.global_client_options/headers.
     *
     */
    function Client(base) {
        // allow to inherit settings from a base (as prototype) and set owned on top
        rest_api.inherit_options_and_headers(this, base);
        // default path uses the api name
        this.options.path = api_path;
    }

    // set the client class prototype functions
    _.each(api.methods, function(func_info, func_name) {
        Client.prototype[func_name] = function(params) {
            return this._client_request(func_info, params);
        };
    });

    // call a specific REST api function over http request.
    Client.prototype._client_request = function(func_info, params) {
        var self = this;
        return Q.fcall(function() {
            return self._peer_request(func_info, params);
        }).then(null, function(err) {
            console.error('REST REQUEST FAILED '+ err);
            throw err;
        });
    };

    // create a REST api call and return the options for http request.
    Client.prototype._peer_request = function(func_info, params) {

        var self = this;
        var method = func_info.method;
        var path = self.options.path || '/';
        var data = _.clone(params);
        var host = self.options.get_address();
        var jar = self.options.cookie_jars[host];
        var headers = {};
        var body;

        // using forIn to enumerate headers that may be inherited from base headers (see Client ctor).
        _.forIn(self.headers, function(val, key) {
            if (typeof val === 'function') {return;}
            headers[key] = val;
        });

        if (func_info.param_raw) {
            body = data[func_info.param_raw];
            delete data[func_info.param_raw];
            headers['content-type'] = 'application/octet-stream';
            headers['content-length'] = body.length;
            if (!Buffer.isBuffer(body)) {
                dbg.log3('body is not a buffer, try to convert', body);
                body = new Buffer(new Uint8Array(body));
            }
        }

        validate_schema(data, func_info.params_schema, func_info, 'client request');

        // construct the request path for the relevant params
        _.each(func_info.path_items, function(p) {
            if (!p) {
                return;
            } else if (typeof p === 'string') {
                // for plain path strings which are non params
                path = url_path_join(path, p);
            } else {
                assert(p.name in params,
                    'rest_api: missing required path param: ' +
                    p + ' for ' + func_info.fullname);
                path = url_path_join(path, param_to_component(data[p.name], p.param.type));
                delete data[p.name];
            }
        });

        if (jar) {
            headers.cookie = jar.cookieString({
                url: path
            });
        }

        if (!func_info.param_raw && (method === 'POST' || method === 'PUT')) {
            body = JSON.stringify(data);
            headers['content-type'] = 'application/json';
            headers['content-length'] = body.length;
        } else {
            // when func_info.param_raw or GET, HEAD, DELETE we can't use the body,
            // so encode the data into the path query
            _.each(data, function(v, k) {
                data[k] = param_to_component(data[k], func_info.params_properties[k].type);
            });
            var query = querystring.stringify(data);
            if (query) {
                path += '?' + query;
            }
        }

        var options = {
            protocol: self.options.protocol,
            hostname: self.options.hostname,
            port: self.options.port,
            method: method,
            path: path,
            headers: headers,
            // turn off withCredentials for browser xhr requests
            // in order to use allow-origin=* (CORS)
            withCredentials: false,
            // tell browserify http module to use binary data
            responseType: 'arraybuffer'
        };

        if (config.use_ws_when_possible && self.options.is_ws && self.options.peer) {

            dbg.log0('do ws for path '+options.path);

            var peerId = self.options.peer;

            if (options.headers['content-type'] === 'application/json') {
                options.body = body;
            }

            return Q.fcall(function() {
                return ice_api.sendWSRequest(self.options.p2p_context, peerId, options, self.options.timeout);
            }).then(function(res) {
                dbg.log0(self.options, 'res is: '+ require('util').inspect(res));

                if (res && res.status && res.status === 500) {
                    dbg.log0('failed '+options.path+' in ws, try http instead');
                    return self._doHttpCall(func_info, options, body);
                } else {
                    if (!func_info.reply_raw) {
                        // check the json reply
                        validate_schema(res.data, func_info.reply_schema, func_info, 'client reply');
                    }
                    return res.data;
                }
            }).then(null, function(err) {
                console.error('WS REST REQUEST FAILED '+ err+' try http instead');
                return self._doHttpCall(func_info, options, body);
            });

        } else if (config.use_ice_when_possible && self.options.peer && (!self.options.ws_socket || self.options.peer !== self.options.ws_socket.idInServer)) { // do ice
            dbg.log0('do ice ' + (self.options.ws_socket && self.options.ws_socket.isAgent ? self.options.ws_socket.idInServer : "not agent") + ' for path '+options.path);
            return Q.fcall(function() {
                var peerId = self.options.peer;

                var buffer;
                if (options.headers['content-type'] === 'application/json') {
                    options.body = body;
                } else {
                    buffer = body;
                }

                return self._doICECallWithRetry(self.options, peerId, options, buffer, func_info, 0);
            }).then(function(res) {
                return res;
            }, function(err) {
                console.error('ICE REST REQUEST FAILED '+ err+' try http instead');
                return self._doHttpCall(func_info, options, body);
            });
        } else { // do http

            dbg.log3('Do Http Call to '+require('util').inspect(options));

            if (config.use_ice_when_possible && self.options.peer) {
                dbg.log0(options, 'do http to self req '+options.path);
                options.hostname = '127.0.0.1';
            }

            return self._doHttpCall(func_info, options, body);
        }
        console.error('YaEL SHOULD NOT REACH HERE');
    };

    Client.prototype._doICECallWithRetry = function doICECallWithRetry(self_options, peerId, options, buffer, func_info, retry) {
        var self = this;
        return Q.fcall(function () {
            return self._doICECall(self_options, peerId, options, buffer, func_info);
        }).then(function(res) {
            return res;
        }, function(err) {
            if (retry < config.ice_retry && err.toString().indexOf('500') < 0) {
                ++retry;
                console.error('ICE REST REQUEST FAILED '+ err+' retry '+retry);
                return self._doICECallWithRetry(self_options, peerId, options, buffer, func_info, retry);
            } else {
                throw new Error('ICE REST REQUEST FAILED '+ err);
            }

        });
    };

    Client.prototype._doICECall = function doICECall(self_options, peerId, options, buffer, func_info) {
        dbg.log3('do ice req '+require('util').inspect(self_options));

        return Q.fcall(function () {
                return ice_api.sendRequest(self_options.p2p_context, self_options.ws_socket, peerId, options, null, buffer, self_options.timeout);
            })
            .then(function (res) {
                dbg.log0(self_options, 'res is: ' + require('util').inspect(res));
                if (res && res.status && res.status === 500) {
                    dbg.log0('failed ' + options.path + ' in ice, got 500');
                    throw new Error('Do retry with http - ice failure 500');
                } else {

                    if (!func_info.reply_raw) {
                        // check the json reply
                        validate_schema(res.data, func_info.reply_schema, func_info, 'client reply');
                    }
                    return res.data;
                }
            })
            .then(null, function (err) {
                console.error('ICE REST REQUEST FAILED ' + err);
                throw new Error('Do retry with http - ice failure ex');
            });
    };

    Client.prototype._doHttpCall = function doHttpCall(func_info, options, body) {
        var self = this;
        dbg.log3('do http req '+require('util').inspect(options));

        if (options.body) {
            delete options.body;
        }

        return Q.fcall(function() {
            return self._http_request(options, body);
        }).then(read_http_response)
        .then(function(res) {
            return self._handle_http_reply(func_info, res);
        })
        .then(null, function(err) {
            console.error('HTTP REST REQUEST FAILED '+ require('util').inspect(err) +
            ' to '+options.hostname+':'+options.port+' for '+options.method+' '+options.path);
            throw err;
        });
    };

    // create a REST api call and return the options for http request.
    Client.prototype._http_request = function(options, body) {
        var req = options.protocol === 'https:' ?
            https.request(options) :
            http.request(options);
        dbg.log3('HTTP request', req);

        var defer = Q.defer();
        req.on('error', defer.reject);
        req.on('response', defer.resolve);
        if (body) {
            req.end(body);
        } else {
            req.end();
        }
        if (options.timeout) {
            if (req.setTimeout) {

                try {
                    req.setTimeout(options.timeout, function() {
                        console.error('REQUEST TIMEOUT');
                        req.abort();
                    });
                } catch (ex) {
                    console.error("prob with set request timeout "+ex);
                }
            } else {
                // TODO browserify doesn't implement req.setTimeout...
            }
        }
        return defer.promise;
    };

    Client.prototype._handle_http_reply = function(func_info, res) {
        var self = this;
        var cookies = res.response.headers['set-cookie'];
        if (cookies) {
            var host = self.options.get_address();
            var jars = self.options.cookie_jars;
            var jar = jars[host] = jars[host] || new Cookie.Jar();
            _.each(cookies, function(cookie_str) {
                jar.add(new Cookie(cookie_str));
            });
        }
        if (!func_info.reply_raw) {
            // check the json reply
            validate_schema(res.data, func_info.reply_schema, func_info, 'client reply');
        }
        return res.data;
    };



    return api;
}



/**
 *
 * rest_api.global_client_options
 *
 * global object with client options.
 * used in options inheritance (see rest_api.inherit_options_and_headers).
 * one may also use to set global options in the process (see coretest setting server port).
 *
 * available options (inherited or owned):
 * - protocol (String)
 * - hostname (String)
 * - port (Number)
 * - path (String) - optional base path for the host (default to the api name)
 * - cookie_jars (Object) - optional object map from host to cookie jar (default to global object)
 */
rest_api.global_client_options = {

    /**
     * get/set hostname and port
     */
    get_address: function() {
        return URL.format({
            protocol: this.protocol,
            hostname: this.hostname,
            port: this.port
        });
    },
    set_address: function(address) {
        var u = URL.parse(address);
        this.protocol = u.protocol;
        this.hostname = u.hostname;
        this.port = u.port;
    },
    set_peer: function (peer) {
        this.peer = peer;
    },


    set_timeout: function(ms) {
        this.timeout = ms;
    },
    set_ws: function(ws) {
        this.ws_socket = ws;
    },
    set_p2p_context: function(context) {
        this.p2p_context = context;
    },
    set_is_ws: function() {
        this.is_ws = true;
    },

    /**
     * cookie jars are needed to maintain cookie sessions.
     * in nodes.js we save set-cookie replies only in memory.
     * in a the browser then browserify http module already saves the cookies persistently.
     * the default cookie jar is global for all api's which is convinient, and suitable unless
     * need to maintain multiple separated sessions between the same client and host.
     */
    cookie_jars: {},
};


/**
 *
 * rest_api.global_client_headers
 *
 * global object with client headers.
 * used in headers inheritance (see rest_api.inherit_options_and_headers).
 * one may also use to set global headers in the process.
 *
 */
rest_api.global_client_headers = {

    /**
     * get/set a token in Bearer autorization header
     */
    get_auth_token: function() {
        return this.authorization && this.authorization.slice('Bearer '.length);
    },
    set_auth_token: function(token) {
        if (token) {
            this.authorization = 'Bearer ' + token;
        } else {
            this.authorization = '';

            // deleting the field causes a 'Bearer undefined' value to appear,
            // probably in another inherited headers object. not sure how/why...
            // delete this.authorization;
        }
        console.log('set_auth_token', typeof token,
            token ? token.slice(0, 20) + '...' : '\'\'');
    },

    /**
     * common headers
     */
    accept: '*/*',
};


/**
 *
 * rest_api.inherit_options_and_headers
 *
 * in order to allow inherited options and headers we use prototype inheritance
 *
 */
rest_api.inherit_options_and_headers = function(target, base) {
    target.options = Object.create(base && base.options || rest_api.global_client_options);
    target.headers = Object.create(base && base.headers || rest_api.global_client_headers);
};



///////////
// UTILS //
///////////


tv4.addFormat('date', function(data) {
    var d = new Date(data);
    return isNaN(d.getTime()) ? 'bad date' : null;
});


function validate_schema(obj, schema, info, desc) {
    var result = tv4.validateResult(
        obj, schema,
        true /*checkRecursive*/ ,
        true /*banUnknownProperties*/ );
    if (!result.valid) {
        console.error('INVALID SCHEMA', desc, schema, obj);
        result.info = info;
        result.desc = desc;
        throw result;
    }
}

function param_to_component(param, type) {
    if (type === 'array' || type === 'object') {
        return encodeURIComponent(JSON.stringify(param));
    } else if (type === 'string') {
        return encodeURIComponent(param.toString());
    } else {
        return param.toString();
    }
}

function component_to_param(component, type) {
    if (type === 'array' || type === 'object') {
        if (typeof component === type) {
            return component; // already parsed
        } else {
            return JSON.parse(decodeURIComponent(component));
        }
    } else if (type === 'string') {
        return decodeURIComponent(String(component));
    } else if (type === 'integer') {
        return Number(component) | 0;
    } else if (type === 'number') {
        return Number(component);
    } else if (type === 'boolean') {
        return Boolean(component);
    } else {
        return component;
    }
}


// send http request and return a promise for the response
function read_http_response(res) {
    var chunks = [];
    var chunks_length = 0;
    var defer = Q.defer();
    dbg.log3('HTTP response headers', res.statusCode, res.headers);
    res.on('error', defer.reject);
    res.on('data', add_chunk);
    res.on('end', finish);
    return defer.promise;

    function add_chunk(chunk) {
        dbg.log3('HTTP response data', chunk.length, typeof(chunk));
        chunks.push(chunk);
        chunks_length += chunk.length;
    }

    function concat_chunks() {
        if (!chunks_length) {
            return '';
        }
        if (typeof(chunks[0]) === 'string') {
            // if string was already decoded then keep working with strings
            return String.prototype.concat.apply('', chunks);
        }
        // binary data buffers for the win!
        if (!Buffer.isBuffer(chunks[0])) {
            // in case of xhr arraybuffer just wrap with node buffers
            chunks = _.map(chunks, Buffer);
        }
        return Buffer.concat(chunks, chunks_length);
    }

    function decode_response(data) {
        var content_type = res.headers['content-type'];
        var is_json = content_type && content_type.split(';')[0] === 'application/json';
        return is_json && data && JSON.parse(data.toString()) || data;
    }

    function finish() {
        dbg.log3('HTTP response finish', res);
        try {
            var data = decode_response(concat_chunks());
            if (res.statusCode !== 200) {
                defer.reject({
                    status: res.statusCode,
                    data: data.toString()
                });
            } else {
                defer.resolve({
                    response: res,
                    data: data
                });
            }
        } catch (err) {
            defer.reject(err);
        }
    }
}

function url_path_join() {
    return _.reduce(arguments, function(path, item) {
        if (path[path.length - 1] === '/' || item[0] === '/') {
            return path + item;
        } else {
            return path + '/' + item;
        }
    }, '');
}
