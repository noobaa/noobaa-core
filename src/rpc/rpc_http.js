'use strict';

var _ = require('lodash');
var Q = require('q');
var express = require('express');
var express_morgan_logger = require('morgan');
var express_body_parser = require('body-parser');
var express_method_override = require('method-override');
var express_compress = require('compression');
var http = require('http');
var https = require('https');
var pem = require('pem');
var dbg = require('noobaa-util/debug_module')(__filename);

var BASE_PATH = '/rpc';

/**
 *
 * rpc http transport
 *
 * marked as not "reusable" so that the rpc connection will not be cached
 * for other requests on the same address, since node's http module
 * does socket pooling by http.globalAgent, then in this http transport
 * simply uses a new RpcConnection for every request.
 */
module.exports = {
    BASE_PATH: BASE_PATH,
    singleplex: true,
    connect: connect,
    close: close,
    listen: listen,
    create_server: create_server,
    middleware: middleware,
    send: send,
    authenticate: authenticate,
};


// increase the maximum sockets per host, the default is 5 which is very low
if (http.globalAgent && http.globalAgent.maxSockets < 100) {
    http.globalAgent.maxSockets = 100;
}
// same for http-browserify
if (http.Agent && http.Agent.defaultMaxSockets < 100) {
    http.Agent.defaultMaxSockets = 100;
}

var browser_location = global.window && global.window.location;
var is_browser_secure = browser_location && browser_location.protocol === 'https:';

/**
 *
 * connect
 *
 */
function connect(conn, options) {
    if (conn.url.protocol === 'http:' && is_browser_secure) {
        throw new Error('HTTP INSECURE - cannot use http: from secure browser page');
    }
    conn.http = {};
}


/**
 *
 * close
 *
 */
function close(conn) {
    // try to abort the connetion's running request
    var req = conn.http.req;
    if (req && req.abort) {
        req.abort();
    }
}


/**
 *
 * send
 *
 */
function send(conn, msg, op, req) {

    // http 1.1 has no multiplexing over connections,
    // so we issue a single request per connection.

    if (op === 'res') {
        return send_http_response(conn, msg, req);
    } else {
        return send_http_request(conn, msg, req);
    }
}


/**
 *
 * send_http_response
 *
 */
function send_http_response(conn, msg, req) {
    var res = conn.http.res;
    res.status(200).end(msg);
}


/**
 *
 * send_http_request
 *
 */
function send_http_request(conn, msg, rpc_req) {
    var headers = {};

    // set the url path only for logging to show it,
    // and encode the connection id in the path querystring
    var path = BASE_PATH + rpc_req.srv +
        '?nb_time=' + conn.time.toString(16) +
        '&nb_rand=' + conn.rand.toString(16);

    conn.http.reqid = rpc_req.reqid;

    // encode the auth_token in the authorization header,
    // we don't really need to, it's just to try and look like a normal http resource
    // if (conn.http.auth_token) {
    // headers.authorization = 'Bearer ' + conn.http.auth_token;
    // }

    // for now just use POST for all requests instead of req.method_api.method,
    // and send the body as binary buffer
    var http_method = 'POST';
    var body = msg;
    if (Buffer.isBuffer(body)) {
        headers['content-length'] = body.length;
        headers['content-type'] = 'application/octet-stream';
    } else {
        headers['content-length'] = body.length;
        headers['content-type'] = 'application/json';
    }

    var http_options = {
        protocol: conn.url.protocol,
        hostname: conn.url.hostname,
        port: conn.url.port,
        method: http_method,
        path: path,
        headers: headers,
        // turn off withCredentials for browser xhr requests
        // in order to use allow-origin=* (CORS)
        withCredentials: false,
        // tell browserify http module to use binary data
        responseType: 'arraybuffer'
    };

    var req = conn.http.req =
        (http_options.protocol === 'https:') ?
        https.request(http_options) :
        http.request(http_options);

    dbg.log3('HTTP request', req.method,
        req.path, req._headers);

    var send_defer = Q.defer();

    // reject on send errors
    req.on('error', send_defer.reject);

    // once a response arrives read and handle it
    req.on('response', function(res) {
        if (!res.statusCode) {
            // statusCode = 0 means ECONNREFUSED and the response
            // will not emit events in such case
            send_defer.reject('ECONNREFUSED');
            conn.emit('error', new Error('ECONNREFUSED'));
            return;
        }
        send_defer.resolve();
        conn.http.res = res;
        read_http_response_data(res)
            .then(function(data) {
                if (res.statusCode !== 200) {
                    throw new Error('HTTP ERROR ' + res.statusCode + ' ' +
                        data + ' to ' + conn.url.href);
                }
                dbg.log3('HTTP RESPONSE', res.statusCode, 'length', data.length);
                conn.receive(data);
            })
            .done(null, function(err) {
                dbg.error('HTTP RESPONSE ERROR', err.stack || err);
                conn.receive({
                    header: {
                        op: 'res',
                        reqid: conn.http.reqid,
                        error: err
                    }
                });
            });
    });

    // send the request data
    if (body) {
        req.end(body);
    } else {
        req.end();
    }

    return send_defer.promise;
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

    function decode_response(headers, data) {
        var content_type = headers && headers['content-type'];
        var is_json = _.contains(content_type, 'application/json');
        return is_json && data && JSON.parse(data.toString()) || data;
    }

    function finish() {
        try {
            var data = concat_chunks();
            data = decode_response(res.headers, data);
            defer.resolve(data);
        } catch (err) {
            defer.reject(err);
        }
    }
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
        Q.fcall(function() {
            res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
            res.header('Access-Control-Allow-Origin', '*');
            // note that browsers will not allow origin=* with credentials
            // but anyway we allow it by the agent server.
            res.header('Access-Control-Allow-Credentials', true);
            if (req.method === 'OPTIONS') {
                res.status(200).end();
                return;
            }
            var host = req.connection.remoteAddress;
            var port = req.connection.remotePort;
            var proto = req.get('X-Forwarded-Proto') || req.protocol;
            var address = proto + '://' + host + ':' + port;
            var conn = rpc.new_connection(
                address,
                req.query.nb_time,
                req.query.nb_rand);
            conn.http = {
                req: req,
                res: res
            };
            return conn.receive(req.body);
        }).then(null, function(err) {
            res.status(500).send(err);
        });
    };
}


/**
 *
 * listen
 *
 */
function listen(rpc, app) {
    app.use(BASE_PATH, middleware(rpc));
}


/**
 *
 * create_server
 *
 */
function create_server(rpc, port, secure, logging) {
    var app = express();
    if (logging) {
        app.use(express_morgan_logger('dev'));
    }
    app.use(express_body_parser.json());
    app.use(express_body_parser.raw({
        // increase size limit on raw requests to allow serving data blocks
        limit: 4 * 1024 * 1024
    }));
    app.use(express_body_parser.text());
    app.use(express_body_parser.urlencoded({
        extended: false
    }));
    app.use(express_method_override());
    app.use(express_compress());
    app.use(BASE_PATH, middleware(rpc));

    return Q.fcall(function() {
            return secure && Q.nfcall(pem.createCertificate, {
                days: 365 * 100,
                selfSigned: true
            });
        })
        .then(function(cert) {
            var server = secure ?
                https.createServer({
                    key: cert.serviceKey,
                    cert: cert.certificate
                }, app) :
                http.createServer(app);
            return Q.ninvoke(server, 'listen', port)
                .thenResolve(server);
        });
}


/**
 *
 * authenticate
 *
 */
function authenticate(conn, auth_token) {
    // TODO for now just save auth_token and send with every message, better send once
}
