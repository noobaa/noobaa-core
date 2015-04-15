'use strict';

var _ = require('lodash');
var Q = require('q');
var url = require('url');
var http = require('http');
var https = require('https');
var assert = require('assert');
var Cookie = require('cookie-jar');
var querystring = require('querystring');
var dbg = require('noobaa-util/debug_module')(__filename);

var BASE_PATH = '/rpc/';

module.exports = {
    request: request,
    middleware: middleware,
    BASE_PATH: BASE_PATH,
};


// increase the maximum sockets per host, the default is 5 which is very low
if (http.globalAgent && http.globalAgent.maxSockets < 100) {
    http.globalAgent.maxSockets = 100;
}
// same for http-browserify
if (http.Agent && http.Agent.defaultMaxSockets < 100) {
    http.Agent.defaultMaxSockets = 100;
}




/**
 *
 * request
 *
 * send rpc request over http/s
 *
 */
function request(rpc, api, method_api, params, options) {
    var req;
    var host_address;

    return Q.fcall(function() {
            var address = url.parse(options.address || '');
            var method = method_api.method;
            var path = BASE_PATH + api.name +
                '/' + method_api.name +
                '/' + (options.domain || '');
            var data = _.clone(params);
            var headers = {};
            var body;

            // using forIn to enumerate headers that may be
            // inherited from base headers.
            _.forIn(options.headers, function(v, k) {
                headers[k] = v;
            });

            if (method_api.param_raw) {
                body = data[method_api.param_raw];
                delete data[method_api.param_raw];
                headers['content-type'] = 'application/octet-stream';
                headers['content-length'] = body.length;
                if (!Buffer.isBuffer(body)) {
                    dbg.log3('body is not a buffer, try to convert', body);
                    body = new Buffer(new Uint8Array(body));
                }
            }

            if (options.auth_token) {
                headers.authorization = 'Bearer ' + options.auth_token;
            }

            host_address = url.format(_.pick(options, 'protocol', 'hostname', 'port'));
            var jar = options.cookie_jars && options.cookie_jars[host_address];
            if (jar) {
                headers.cookie = jar.cookieString({
                    url: path
                });
            }

            if (!method_api.param_raw && (method === 'POST' || method === 'PUT')) {
                body = JSON.stringify(data);
                headers['content-type'] = 'application/json';
                headers['content-length'] = body.length;
            } else {
                // when method_api.param_raw or GET, HEAD, DELETE we can't use the body,
                // so encode the data into the path query
                _.each(data, function(v, k) {
                    data[k] = param_to_component(data[k], method_api.params_properties[k].type);
                });
                var query = querystring.stringify(data);
                if (query) {
                    path += '?' + query;
                }
            }

            var http_options = {
                protocol: address.protocol,
                hostname: address.hostname,
                port: address.port,
                method: method,
                path: path,
                headers: headers,
                // turn off withCredentials for browser xhr requests
                // in order to use allow-origin=* (CORS)
                withCredentials: false,
                // tell browserify http module to use binary data
                responseType: 'arraybuffer'
            };

            req = (http_options.protocol === 'https:') ?
                https.request(http_options) :
                http.request(http_options);

            dbg.log3('HTTP request', req.method, req.path, req._headers);

            // send and read response
            var promise =
                send_http_request(req, body)
                .then(read_http_response_data);

            // why set the timeout here if the caller already
            // set timeout on the entire promise:
            //
            // the reason is that we want to call req.abort() to allow the http module
            // (which can be node http or browserify) to interrupt the request
            // as soon as possible.
            // it is not sure if there is really a case where it can interrupt a
            // running requests but if there is then it's worth setting another timeout.
            if (options.timeout && req.abort) {
                promise = promise
                    .timeout(options.timeout, 'HTTP REQUEST TIMEOUT')
                    .then(null, function(err) {
                        req.abort();
                        throw err;
                    });
            }
            return promise;
        })
        .then(function(res) {

            // handle set-cookie response
            var cookies = res.response.headers['set-cookie'];
            if (cookies) {
                if (!options.cookie_jars) {
                    dbg.log0('HTTP set-cookie ignored (no cookie_jars)');
                } else {
                    var jar = options.cookie_jars[host_address] =
                        options.cookie_jars[host_address] || new Cookie.Jar();
                    _.each(cookies, function(cookie_str) {
                        jar.add(new Cookie(cookie_str));
                    });
                }
            }
            return res.data;
        });
}




/**
 *
 * middleware
 *
 * @return express middleware to route requests and call rpc methods
 *
 */
function middleware(rpc) {
    return function(req, res) {
        var method;
        Q.fcall(function() {
                // skip first split item if empty due to leading '/'
                var path_split = req.path.split('/', 4);
                var api_name = path_split.shift() || path_split.shift();
                var method_name = path_split.shift();
                var domain = path_split.shift();
                method = rpc.get_service_method(api_name, domain, method_name);

                if (!method) {
                    throw {
                        statusCode: 400,
                        data: 'RPC: no such method ' + req.path
                    };
                }

                res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
                res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
                res.header('Access-Control-Allow-Origin', '*');
                // note that browsers will not allow origin=* with credentials
                // but anyway we allow it by the agent server.
                res.header('Access-Control-Allow-Credentials', true);

                if (req.method === 'OPTIONS') {
                    return;
                }

                // get request params from query / body
                var rpc_req = {};
                if (method.method_api.param_raw) {
                    rpc_req.rpc_params = {};
                    rpc_req.rpc_params[method.method_api.param_raw] = req.body;
                } else {
                    rpc_req.rpc_params = req.body;
                }
                _.each(req.query, function(v, k) {
                    rpc_req.rpc_params[k] = component_to_param(v,
                        method.method_api.params_properties[k].type);
                });

                var http_auth = req.header('authorization');
                if (http_auth) {
                    // slice the token starting from offset 7 === 'Bearer '.length
                    rpc_req.auth_token = http_auth.slice(7);
                }

                // call rpc method handler
                return method.handler(rpc_req);
            })
            .then(function(reply) {
                if (!reply || req.method === 'HEAD') {
                    res.end();
                } else if (method.method_api.reply_raw) {
                    res.send(reply);
                } else {
                    res.json(reply);
                }
            })
            .then(null, function(err) {
                try {
                    var status = err.statusCode;
                    if (typeof status !== 'number' || status < 300 || status >= 600) {
                        status = 500;
                    }
                    var data = err.data || err.toString();
                    res.status(status).send(data);
                } catch (ex) {
                    console.error('EXCEPTION WHILE SENDING HTTP ERROR', err, ex);
                }
            });
    };
}





// UTILS //////////////////////////////////////////////////////////////////////



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
        return parseInt(component, 10);
    } else if (type === 'number') {
        return Number(component);
    } else if (type === 'boolean') {
        return Boolean(component);
    } else {
        return component;
    }
}


function decode_response(headers, data) {
    var content_type = headers && headers['content-type'];
    var is_json = content_type && content_type.split(';')[0] === 'application/json';
    return is_json && data && JSON.parse(data.toString()) || data;
}


/**
 *
 * send_http_request
 *
 * @return promise for http response
 *
 */
function send_http_request(req, body) {
    var defer = Q.defer();
    req.on('error', defer.reject);
    req.on('response', defer.resolve);
    if (body) {
        req.end(body);
    } else {
        req.end();
    }
    return defer.promise;
}


/**
 *
 * read_http_response_data
 *
 * @return promise for the response data
 *
 */
function read_http_response_data(res) {
    var chunks = [];
    var chunks_length = 0;
    dbg.log3('HTTP response headers', res.statusCode, res.headers);

    // statusCode = 0 means we don't even have a response to work with
    if (!res.statusCode) {
        throw new Error('HTTP ERROR CONNECTION REFUSED');
    }

    var defer = Q.defer();
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

    function finish() {
        dbg.log3('HTTP response finish', res);
        try {
            var data = decode_response(res.headers, concat_chunks());
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
