// this module is written for both nodejs, or for client with browserify.
'use strict';

var http = require('http');
var https = require('https');
var querystring = require('querystring');
var _ = require('underscore');
var Q = require('q');
var assert = require('assert');
var URL = require('url');
var PATH = require('path');
var request = require('request');


module.exports = {
    define_api: define_api,
};


var VALID_METHODS = {
    GET: 1,
    PUT: 1,
    POST: 1,
    DELETE: 1
};
var PATH_ITEM_RE = /^\S*$/;


// Check and initialize the api structure.
//
// api (Object): 
// - each key is func_name (String)
// - each value is func_info (Object):
//   - method (String) - http method GET/POST/...
//   - path (Function) - function(params) that returns the path (String) for the call
//   - data (Function) - function(params) that returns the data (String|Buffer) for the call
//
function define_api(api) {

    // client class for the api.
    // creating a client instance takes client_params,
    // which is needed for when doing the actual calls.
    // 
    // client_params (Object):
    // - hostname (String)
    // - port (Number)
    // - path (String) - base path for the host
    //
    function Client(client_params) {
        this._restful_client_params = client_params || {};
    }

    Client.prototype.set_param = function(key, value) {
        this._restful_client_params[key] = value;
    };

    // server class for the api.
    // 
    // methods (Object): map of function names to function(params).
    //
    // allow_missing_methods (String): 
    //    call with allow_missing_methods==='allow_missing_methods' to make the server 
    //    accept missing functions, the handler for missing functions will fail on runtime.
    //    useful for test servers.
    //
    function Server(methods, middlewares, allow_missing_methods) {
        var me = this;
        if (allow_missing_methods) {
            assert.strictEqual(allow_missing_methods, 'allow_missing_methods');
        }
        me._middlewares = middlewares || [];
        me._impl = {};
        me._handlers = {};
        _.each(api.methods, function(func_info, func_name) {
            var func = methods[func_name];
            if (!func && allow_missing_methods) {
                func = function(params) {
                    return Q.reject({
                        data: 'Missing server impl of ' + func_name
                    });
                };
            }
            assert.strictEqual(typeof(func), 'function',
                'Missing server function ' + func_name);
            me._impl[func_name] = func;
            me._handlers[func_name] = create_server_handler(me, func, func_info);
        });
    }

    // install the server handlers to the given router.
    //
    // router (Object) - express/connect style app router with the following functions:
    // - get,post,put,delete which are function(path, handler).
    //
    // base_path (String) - optional base path for the routes.
    //
    Server.prototype.install_routes = function(router, base_path) {
        var me = this;
        base_path = base_path || '';
        var doc_base = PATH.join(base_path, 'doc', api.name);
        _.each(me._middlewares, function(fn) {
            assert(fn, 'undefined middleware function');
            router.use(base_path, function(req, res, next) {
                Q.fcall(fn, req).done(function() {
                    return next();
                }, function(err) {
                    return next(err);
                });
            });
        });
        _.each(api.methods, function(func_info, func_name) {
            // install the path handler
            var path = PATH.join(base_path, func_info.path);
            var handler = me._handlers[func_name];
            install_route(router, func_info.method, path, handler);

            // install also a documentation route
            router.get(PATH.join(doc_base, func_name), function(req, res) {
                res.send(func_info.doc);
                // TODO should return also params/reply/other-info doc
            });
        });
    };

    // call to bypass the server routes
    Server.prototype.disable_routes = function() {
        this._disabled = true;
    };

    // call to start logging the server requests
    Server.prototype.set_logging = function() {
        this._log = console.log.bind(console);
    };


    var method_and_path_collide = {};

    // go over the api and check its validity
    _.each(api.methods, function(func_info, func_name) {
        // add the name to the info
        func_info.name = func_name;
        func_info.params = func_info.params || {};
        func_info.reply = func_info.reply || {};

        assert(func_info.method in VALID_METHODS,
            'unexpected method: ' + func_info);

        assert.strictEqual(typeof(func_info.path), 'string',
            'unexpected path type: ' + func_info);

        // split the path to its items
        func_info.path_items = _.map(func_info.path.split('/'), function(p) {
            assert(PATH_ITEM_RE.test(p),
                'invalid path item: ' + p + ' of ' + func_info);

            // if a normal path item, just return the string
            if (p[0] !== ':') {
                return p;
            }
            // if a param item (starts with colon) find the param info
            p = p.slice(1);
            var param = func_info.params[p];
            assert(param, 'missing param info: ' + p + ' of ' + func_info);
            return {
                name: p,
                param: param,
            };
        });

        // test for colliding method+path
        var method_and_path = func_info.method + func_info.path;
        var collision = method_and_path_collide[method_and_path];
        assert(!collision, 'collision of method+path: ' + func_info.name + ' ~ ' + collision);
        method_and_path_collide[method_and_path] = func_info.name;

        // set the client class prototype functions
        Client.prototype[func_name] = function(params) {
            // resolve this._restful_client_params to use the client object
            return do_client_request(this._restful_client_params, func_info, params);
        };
    });

    // add the client and server classes to the api object
    api.Client = Client;
    api.Server = Server;

    return api;
}



// call a specific REST api function over http request.
function do_client_request(client_params, func_info, params) {
    return Q.fcall(function() {
        // first prepare the request
        return create_client_request(client_params, func_info, params);
    }).then(function(options) {
        // now send it over http
        return send_http_request(options);
    }).then(function(res) {
        // get the reply and return
        var reply = res.data;
        check_undefined_params(func_info.name, func_info.reply, reply);
        check_params_by_info(func_info.name, func_info.reply, reply, 'decode');
        return res;
    }).then(null, function(err) {
        console.error('RESTFUL REQUEST FAILED', err);
        throw err;
    });
}


// create a REST api call and return the options for http request.
function create_client_request(client_params, func_info, params) {
    var method = func_info.method;
    var path = client_params.path || '/';
    var data = _.clone(params);
    check_undefined_params(func_info.name, func_info.params, data);
    check_params_by_info(func_info.name, func_info.params, data, 'encode');
    _.each(func_info.path_items, function(p) {
        if (!p) {
            return;
        } else if (typeof(p) === 'string') {
            path = PATH.join(path, p);
        } else {
            assert(p.name in params, 'missing required path param: ' + p + ' of ' + func_info.name);
            path = PATH.join(path, data[p.name].toString());
            delete data[p.name];
        }
    });
    var query;
    var body;
    if (method === 'POST' || method === 'PUT') {
        body = data;
    } else {
        query = data;
    }
    var url = URL.format({
        // TODO what to do to support https?
        protocol: 'http',
        hostname: client_params.hostname || 'localhost',
        port: client_params.port,
        pathname: path,
    });
    var options = {
        jar: true,
        json: true,
        method: method,
        url: url,
        qs: query,
        body: body,
    };
    return options;
}


// send http request and return a promise for the response
function send_http_request(options) {
    var defer = Q.defer();
    request(options, function(err, res, body) {
        if (err) {
            return defer.reject({
                data: err,
            });
        }
        if (res.statusCode !== 200) {
            return defer.reject({
                status: res.statusCode,
                data: body,
            });
        } else {
            return defer.resolve({
                response: res,
                data: body,
            });
        }
    });
    return defer.promise;
}




// return a route handler that calls the server function
function create_server_handler(server, func, func_info) {
    return function(req, res, next) {
        // marking _disabled on the server will bypass all the routes it has.
        if (server._disabled) {
            return next();
        }
        var log_func = server._log || function() {};
        Q.fcall(function() {
            check_req_params_by_info(func_info.name, func_info.params, req, 'decode');
            // server functions are expected to return a promise
            return func(req, res, next);
        }).then(function(reply) {
            log_func('SERVER COMPLETED', func_info.name);
            if (reply) {
                check_undefined_params(func_info.name, func_info.reply, reply);
                check_params_by_info(func_info.name, func_info.reply, reply, 'encode');
            }
            return res.json(200, reply);
        }).then(null, function(err) {
            log_func('SERVER ERROR', func_info.name, ':', err, err.stack);
            var status = err.status || err.statusCode;
            var data = err.data || err.message || err.toString();
            if (typeof status === 'number' &&
                status >= 100 &&
                status < 600
            ) {
                return res.json(status, data);
            } else {
                return res.json(500, data);
            }
        }).done(null, function(err) {
            log_func('SERVER ERROR WHILE SENDING ERROR', func_info.name, ':', err, err.stack);
            return next(err);
        });
    };
}


// install a route handler for the given router.
// see install_routes().
function install_route(router, method, path, handler) {
    // route_func points to the route functions router.get/post/put/delete
    var route_func = router[method.toLowerCase()];
    // call the route function to set the route handler
    route_func.call(router, path, handler);
}


function check_undefined_params(func_name, params_info, params) {
    _.each(params, function(value, name) {
        if (!(name in params_info)) {
            throw new Error('undefined api param: ' + name + ' of ' + func_name);
        }
    });
}

var TYPES = [{
    type: String,
    check: _.isString,
    encode: function(arg) {
        return String(arg);
    },
    decode: function(arg) {
        return String(arg);
    },
}, {
    type: Number,
    check: _.isNumber,
    encode: function(arg) {
        return Number(arg);
    },
    decode: function(arg) {
        return Number(arg);
    },
}, {
    type: Boolean,
    check: _.isBoolean,
    encode: function(arg) {
        return Boolean(arg);
    },
    decode: function(arg) {
        return Boolean(arg);
    },
}, {
    type: Date,
    check: _.isDate,
    encode: function(arg) {
        return arg.valueOf();
    },
    decode: function(arg) {
        return new Date(Number(arg));
    },
}, {
    type: RegExp,
    check: _.isRegExp,
    cast: function(arg) {
        return new RegExp(arg);
    },
    encode: function(arg) {
        return arg.toString();
    },
    decode: function(arg) {
        return new RegExp(arg);
    },
}, {
    type: Array,
    check: _.isArray,
    encode: function(arg) {
        return arg;
    },
    decode: function(arg) {
        return arg;
    },
}, {
    type: Object,
    check: _.isObject,
    encode: function(arg) {
        return arg;
    },
    decode: function(arg) {
        return Object(arg);
    },
}];

function check_params_by_info(func_name, params_info, params, coder_type) {
    _.each(params_info, function(param_info, name) {
        params[name] = check_param_by_info(func_name, name, param_info, params[name], coder_type);
    });
}

function check_req_params_by_info(func_name, params_info, req, coder_type) {
    req.restful_params = {};
    req.restful_param = function(name) {
        return req.restful_params[name];
    };
    _.each(params_info, function(param_info, name) {
        req.restful_params[name] = check_param_by_info(
            func_name, name, param_info,
            req.param(name), coder_type
        );
    });
}

function check_param_by_info(func_name, name, info, value, coder_type) {
    assert(!_.isUndefined(value) || !info.required,
        'missing required param: ' + name + ' of ' + func_name);
    var type = info.type || info;
    var t = _.findWhere(TYPES, {
        type: type
    });
    assert(t, 'unknown param type: ' + name + ' of ' + func_name);
    var result = t[coder_type].call(null, value);
    // console.log('TYPE RESULT', coder_type, func_name, name, t.type.name,
    // result.valueOf(), typeof(result), '(value=', value.valueOf(), ')');
    return result;
}
