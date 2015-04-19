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
var querystring = require('querystring');
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
    reusable: false,
    connect: connect,
    authenticate: authenticate,
    send: send,
    close: close,
    listen: listen,
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


function connect(conn) {
    // noop
}

function authenticate(conn, auth_token) {
    conn.auth_token = auth_token;
}


/**
 *
 * send
 *
 * send rpc request/response over http/s
 *
 */
function send(conn, msg, op) {
    if (op === 'res') {
        send_response(conn, msg);
    } else {
        send_request(conn, msg);
    }
}

/**
 *
 * send_request
 *
 * send rpc request over http/s
 *
 */
function send_request(conn, req) {
    var headers = {};

    // encode the api, domain and method name in the url path
    var path = BASE_PATH;

    // http 1.1 has no multiplexing, so single request per connection
    conn.req = req;

    // encode the auth_token in the authorization header,
    // we don't really need to, it's just to try and look like a normal http resource
    if (conn.auth_token) {
        headers.authorization = 'Bearer ' + conn.auth_token;
    }

    // for now just use POST for all requests instead of req.method_api.method,
    // and send the body as binary buffer
    var http_method = 'POST';
    var body = req.encode_message(req.export_message());
    headers['content-length'] = body.length;
    headers['content-type'] = 'application/octet-stream';

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

    var http_req = conn.http_req =
        (http_options.protocol === 'https:') ?
        https.request(http_options) :
        http.request(http_options);

    dbg.log3('HTTP request', http_req.method,
        http_req.path, http_req._headers);

    var send_defer = Q.defer();

    // waiting for the request to finish sending all data (form.pipe or empty)
    http_req.on('finish', send_defer.resolve);

    // reject on send errors
    http_req.on('error', send_defer.reject);

    // once a response arrives read and handle it
    http_req.on('response', handle_response.bind(null, conn));

    // send the request data
    if (body) {
        http_req.end(body);
    } else {
        http_req.end();
    }

    return send_defer.promise;
}


function handle_response(conn, http_res) {
    conn.http_res = http_res;
    return read_http_response_data(http_res)
        .then(function(data) {
            if (!http_res.statusCode) {
                throw new Error('HTTP ERROR CONNECTION REFUSED');
            } else if (http_res.statusCode !== 200) {
                throw new Error(JSON.parse(data));
            }
            conn.emit('message', data);
        })
        .then(null, function(err) {
            conn.emit('error', {
                reqid: conn.req.reqid,
                error: err
            });
        });
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
        return;
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
            var data = concat_chunks();
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
    return function(http_req, http_res) {
        Q.fcall(function() {
            http_res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
            http_res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
            http_res.header('Access-Control-Allow-Origin', '*');
            // note that browsers will not allow origin=* with credentials
            // but anyway we allow it by the agent server.
            http_res.header('Access-Control-Allow-Credentials', true);
            if (http_req.method === 'OPTIONS') {
                return;
            }
            var addr =
                (http_req.headers && http_req.headers['x-forwarded-for']) ||
                (http_req.connection && http_req.connection.remoteAddress);
            var conn = rpc.new_connection('http://' + addr);
            conn.http_req = http_req;
            conn.http_res = http_res;
            conn.emit('message', http_req.body);
        }).then(null, function(err) {
            http_res.status(500).send(err);
        });
    };
}


/**
 *
 * send_response
 *
 * send rpc request over http/s
 *
 */
function send_response(conn, res) {
    if (res.error) {
        conn.http_res.status(res.error.code || 500).send(res.error);
    } else {
        conn.http_res.status(200).send(res.reply);
    }
}


/**
 *
 * close
 *
 * try to abort the connetion's running request
 *
 */
function close(conn) {
    if (conn.http_req && conn.http_req.abort) {
        conn.http_req.abort();
    }
}


function listen(rpc, port) {
    var app = express();
    app.use(express_morgan_logger('dev'));
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

    var http_server = http.createServer(app);
    return Q.ninvoke(http_server, 'listen', port)
        .thenResolve(http_server);
}
