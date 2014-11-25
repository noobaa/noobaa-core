// module targets: nodejs & browserify
'use strict';

var http = require('http');
var https = require('https');
var querystring = require('querystring');
var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var URL = require('url');
var PATH = require('path');
var Cookie = require('cookie-jar');
var tv4 = require('tv4').freshApi();

module.exports = rest_api;

var VALID_METHODS = {
    GET: 1,
    PUT: 1,
    POST: 1,
    DELETE: 1
};
var PATH_ITEM_RE = /^\S*$/;

var global_client_options = {
    // cookie jars are needed to maintain cookie sessions.
    // in nodes.js we save set-cookie replies only in memory.
    // in a the browser then browserify http module already saves the cookies persistently.
    // the default cookie jar is global for all api's which is convinient, and suitable unless
    // need to maintain multiple separated sessions between the same client and host.
    cookie_jars: {},
};
var global_client_headers = {
    accept: '*/*',
};

/**
 * Check and initialize the api structure.
 *
 * api (Object):
 * - each key is func_name (String)
 * - each value is func_info (Object):
 *   - method (String) - http method GET/POST/...
 *   - path (Function) - function(params) that returns the path (String) for the call
 *   - data (Function) - function(params) that returns the data (String|Buffer) for the call
 */
function rest_api(api) {
    var api_path = PATH.join('/api', api.name);

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
                param: param,
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



    ////////////
    // SERVER //
    ////////////


    /**
     * server class for the api.
     *
     * methods (Object): map of function names to function(params).
     *
     * options (Object):
     * - before (Function): called before each server function
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
        self._before = options.before || function() {};
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
            assert.strictEqual(typeof(func), 'function',
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
        var doc_base = PATH.join('/doc', path);

        // install methods on the router
        _.each(api.methods, function(func_info, func_name) {
            var method_path = PATH.join(path, func_info.path);
            var handler = self._handlers[func_name];
            // route_func points to the route functions router.get/post/put/delete
            var route_func = router[func_info.method.toLowerCase()];
            // call the route function to set the route handler
            route_func.call(router, method_path, handler);

            // install also a documentation route
            router.get(PATH.join(doc_base, func_name), function(req, res) {
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
            Q.fcall(
                function() {
                    req.rest_error = function(data, status) {
                        if (!req._rest_error_data) {
                            req._rest_error_data = data;
                            req._rest_error_status = status;
                        }
                        return new Error('throw rest error');
                    };
                    req.rest_clear_error = function() {
                        req._rest_error_data = undefined;
                        req._rest_error_status = undefined;
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
                    return self._before(req);
                }
            ).then(
                function() {
                    // server functions are expected to return a promise
                    return func(req, res, next);
                }
            ).then(
                function(reply) {
                    if (req._rest_error_data) {
                        throw new Error('rethrow rest error');
                    }
                    self._log('SERVER COMPLETED', func_info.name);
                    if (func_info.reply_raw) {
                        return res.status(200).send(reply);
                    } else {
                        validate_schema(reply, func_info.reply_schema, func_info, 'server reply');
                        return res.status(200).json(reply);
                    }
                }
            ).then(null,
                function(err) {
                    self._log('SERVER ERROR', func_info.name, ':',
                        'REST ERROR', req._rest_error_data,
                        'EXCEPTION', err, err.stack);
                    var status = req._rest_error_status || err.status || err.statusCode;
                    if (typeof status !== 'number' || status < 100 || status >= 600) {
                        status = 500;
                    }
                    var data = req._rest_error_data || 'error';
                    return res.status(status).json(data);
                }
            ).done(null,
                function(err) {
                    self._log('SERVER ERROR WHILE SENDING ERROR', func_info.name, ':', err, err.stack);
                    return next(err);
                }
            );
        };
    };



    ////////////
    // CLIENT //
    ////////////


    /**
     * client class for the api.
     */
    function Client() {
        // allow to set global values or per client values.
        this._options = {};
        this._headers = {};
        // default path uses the api name
        this._options.path = api_path;
    }

    // set the client class prototype functions
    _.each(api.methods, function(func_info, func_name) {
        Client.prototype[func_name] = function(params) {
            return this._client_request(func_info, params);
        };
    });

    function set_property(obj, key, val) {
        if (val) {
            obj[key] = val;
        } else {
            delete obj[key];
        }
    }

    /*
     * available options (either global or per client):
     * - hostname (String)
     * - port (Number)
     * - path (String) - optional base path for the host (default to the api name)
     * - cookie_jars (Object) - optional object map from host to cookie jar (default to global object)
     */
    Client.prototype.set_option = function(key, val) {
        return set_property(this._options, key, val);
    };
    Client.prototype.set_global_option = function(key, val) {
        return set_property(global_client_options, key, val);
    };
    Client.prototype.get_option = function(key) {
        if (this._options.hasOwnProperty(key)) {
            return this._options[key];
        } else {
            return global_client_options[key];
        }
    };
    Client.prototype.get_host = function() {
        return this.get_option('host') ||
            (this.get_option('hostname') + ':' + this.get_option('port'));
    };

    /**
     * set http headers (either global or per client)
     */
    Client.prototype.set_header = function(key, val) {
        return set_property(this._headers, key, val);
    };
    Client.prototype.set_global_header = function(key, val) {
        return set_property(global_client_headers, key, val);
    };
    Client.prototype.set_authorization = function(token) {
        var auth = token && ('Bearer ' + token);
        this.set_header('authorization', auth);
    };
    Client.prototype.set_global_authorization = function(token) {
        var auth = token && ('Bearer ' + token);
        this.set_global_header('authorization', auth);
    };

    // call a specific REST api function over http request.
    Client.prototype._client_request = function(func_info, params) {
        var self = this;
        return Q.fcall(
            function() {
                return self._http_request(func_info, params);
            }
        ).then(
            read_http_response
        ).then(
            function(res) {
                return self._handle_http_reply(func_info, res);
            }
        ).then(null,
            function(err) {
                console.error('REST REQUEST FAILED', err);
                throw err;
            }
        );
    };

    // create a REST api call and return the options for http request.
    Client.prototype._http_request = function(func_info, params) {
        var self = this;
        var method = func_info.method;
        var path = self.get_option('path') || '/';
        var data = _.clone(params);
        var headers = _.extend({}, global_client_headers, self._headers);
        var host = self.get_host();
        var jar = self.get_option('cookie_jars')[host];
        var body;

        if (func_info.param_raw) {
            body = data[func_info.param_raw];
            delete data[func_info.param_raw];
            headers['content-type'] = 'application/octet-stream';
            headers['content-length'] = body.length;
            if (!Buffer.isBuffer(body)) {
                console.log('body is not a buffer, try to convert', body);
                body = new Buffer(new Uint8Array(body));
            }
        }

        validate_schema(data, func_info.params_schema, func_info, 'client request');

        // construct the request path for the relevant params
        _.each(func_info.path_items, function(p) {
            if (!p) {
                return;
            } else if (typeof(p) === 'string') {
                // for plain path strings which are non params
                path = PATH.join(path, p);
            } else {
                assert(p.name in params,
                    'rest_api: missing required path param: ' +
                    p + ' for ' + func_info.fullname);
                path = PATH.join(path, param_to_component(data[p.name], p.param.type));
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
            hostname: self.get_option('hostname'),
            port: self.get_option('port'),
            method: method,
            path: path,
            headers: headers,
            // turn off withCredentials for browser xhr requests
            // in order to use allow-origin=* (CORS)
            withCredentials: false,
            // tell browserify http module to use binary data
            responseType: 'arraybuffer',
        };

        // console.log('HTTP request', options);
        var req = self.get_option('protocol') === 'https' ?
            https.request(options) :
            http.request(options);

        var defer = Q.defer();
        req.on('response', defer.resolve);
        req.on('error', defer.reject);
        if (body) {
            req.write(body);
        }
        req.end();
        return defer.promise;
    };

    Client.prototype._handle_http_reply = function(func_info, res) {
        var self = this;
        var cookies = res.response.headers['set-cookie'];
        if (cookies) {
            var host = self.get_host();
            var jars = self.get_option('cookie_jars');
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
    } else {
        return param.toString();
    }
}

function component_to_param(component, type) {
    if (type === 'array' || type === 'object') {
        if (typeof(component) === type) {
            return component; // already parsed
        } else {
            return JSON.parse(decodeURIComponent(component));
        }
    } else if (type === 'integer') {
        return Number(component) | 0;
    } else if (type === 'number') {
        return Number(component);
    } else if (type === 'boolean') {
        return Boolean(component);
    } else if (type === 'string') {
        return String(component);
    } else {
        return component;
    }
}


// send http request and return a promise for the response
function read_http_response(res) {
    // console.log('HTTP response headers', res.statusCode, res.headers);
    var chunks = [];
    var chunks_length = 0;
    var defer = Q.defer();
    res.on('error', defer.reject);
    res.on('data', add_chunk);
    res.on('end', finish);
    return defer.promise;

    function add_chunk(chunk) {
        // console.log('HTTP response data', chunk.length, typeof(chunk));
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
        try {
            var data = decode_response(concat_chunks());
            if (res.statusCode !== 200) {
                defer.reject({
                    status: res.statusCode,
                    data: data.toString(),
                });
            } else {
                defer.resolve({
                    response: res,
                    data: data,
                });
            }
        } catch (err) {
            defer.reject(err);
        }
    }
}
