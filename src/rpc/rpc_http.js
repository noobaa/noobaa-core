'use strict';

module.exports = RpcHttpConnection;

var _ = require('lodash');
var P = require('../util/promise');
var url = require('url');
var util = require('util');
var http = require('http');
var https = require('https');
var express = require('express');
var express_morgan_logger = require('morgan');
var express_body_parser = require('body-parser');
var express_method_override = require('method-override');
var express_compress = require('compression');
var pem = require('../util/pem');
var dbg = require('../util/debug_module')(__filename);
var EventEmitter = require('events').EventEmitter;
var RpcBaseConnection = require('./rpc_base_conn');


util.inherits(RpcHttpConnection, RpcBaseConnection);

/**
 *
 * RpcHttpConnection
 *
 */
function RpcHttpConnection(addr_url) {
    RpcBaseConnection.call(this, addr_url);
}

/**
 * mark to rpc that this connection is transient
 * because we create http connection per request
 */
RpcHttpConnection.prototype.transient = true;

var BASE_PATH = '/rpc/';
var browser_location = global.window && global.window.location;
var is_browser_secure = browser_location && browser_location.protocol === 'https:';

// increase the maximum sockets per host, the default is 5 which is low
if (http.globalAgent && http.globalAgent.maxSockets < 100) {
    http.globalAgent.maxSockets = 100;
}
// same for http-browserify
if (http.Agent && http.Agent.defaultMaxSockets < 100) {
    http.Agent.defaultMaxSockets = 100;
}


/**
 *
 * connect
 *
 */
RpcHttpConnection.prototype._connect = function() {
    // there is not real need to connect http connections
    // as the actual connection is managed by the nodejs http module
    // so we only manage a transient request-response.
    // see the RpcHttpConnection.prototype.transient = true handling
    if (this.url.protocol === 'http:' && is_browser_secure) {
        throw new Error('HTTP INSECURE - cannot use http: from secure browser page');
    }
    this.emit('connect');
};


/**
 *
 * close
 *
 */
RpcHttpConnection.prototype._close = function() {
    // try to abort the connetion's running request
    if (this.req) {
        if (this.req.abort) {
            dbg.warn('HTTP ABORT REQ', this.reqid);
            this.req.abort();
        }
        this.req = null;
    }
};


/**
 *
 * send
 *
 */
RpcHttpConnection.prototype._send = function(msg, op, req) {
    if (op === 'res') {
        return this.send_http_response(msg, req);
    } else {
        return this.send_http_request(msg, req);
    }
};


/**
 *
 * send_http_response
 *
 */
RpcHttpConnection.prototype.send_http_response = function(msg, req) {
    var res = this.res;
    if (!res) {
        throw new Error('HTTP RESPONSE ALREADY SENT ' + req.reqid);
    }
    res.status(200);
    if (_.isArray(msg)) {
        _.each(msg, function(m) {
            res.write(m);
        });
        res.end();
    } else {
        res.end(msg);
    }
    this.res = null;
};


/**
 *
 * send_http_request
 *
 */
RpcHttpConnection.prototype.send_http_request = function(msg, rpc_req) {
    var self = this;
    var headers = {};

    // set the url path only for logging to show it
    var path = BASE_PATH + rpc_req.srv;

    // use POST for all requests (used to be req.method_api.method but unneeded),
    // and send the body as binary buffer
    var http_method = 'POST';
    var content_length = _.sum(msg, 'length');
    headers['content-length'] = content_length;
    headers['content-type'] = 'application/octet-stream';

    var http_options = {
        protocol: self.url.protocol,
        hostname: self.url.hostname,
        port: self.url.port,
        method: http_method,
        path: path,
        headers: headers,
        // turn off withCredentials for browser xhr requests
        // in order to use allow-origin=* (CORS)
        withCredentials: false,
        // tell browserify http module to use binary data
        responseType: 'arraybuffer'
    };

    var http_req = self.req =
        (http_options.protocol === 'https:') ?
        https.request(http_options) :
        http.request(http_options);

    dbg.log3('HTTP request', http_req.method, http_req.path, http_req._headers);

    var send_defer = P.defer();

    // reject on send errors
    http_req.on('error', send_defer.reject);

    // once a response arrives read and handle it
    http_req.on('response', function(res) {

        // statusCode = 0 means ECONNREFUSED and the response
        // will not emit events in such case
        if (!res.statusCode) {
            send_defer.reject('ECONNREFUSED');
            return;
        }

        // sending is done, so resolve the send promise
        send_defer.resolve();

        // read the response data from the socket
        read_http_response_data(res)
            .then(function(data) {

                // the connection's req is done so no need to abort it on close no more
                self.req = null;

                if (res.statusCode !== 200) {
                    throw new Error('HTTP ERROR ' + res.statusCode + ' ' +
                        data + ' to ' + self.url.href);
                }
                dbg.log3('HTTP RESPONSE', res.statusCode, 'length', data.length);
                self.emit('message', data);
            })
            .done(null, function(err) {

                // the connection's req is done so no need to abort it on close no more
                self.req = null;

                dbg.error('HTTP RESPONSE ERROR', err.stack || err);
                self.emit('message', {
                    header: {
                        op: 'res',
                        reqid: rpc_req.reqid,
                        error: err
                    }
                });
            });
    });

    // send the request data
    if (msg) {
        if (_.isArray(msg)) {
            _.each(msg, function(m) {
                http_req.write(m);
            });
            http_req.end();
        } else {
            http_req.end(msg);
        }
    } else {
        http_req.end();
    }

    return send_defer.promise;
};


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

    var defer = P.defer();
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
 * RpcHttpServer
 *
 */
RpcHttpConnection.Server = RpcHttpServer;

util.inherits(RpcHttpServer, EventEmitter);

function RpcHttpServer() {
    EventEmitter.call(this);
}

/**
 *
 * install
 *
 */
RpcHttpServer.prototype.install = function(app) {
    app.use(BASE_PATH, this.middleware.bind(this));
};


/**
 *
 * middleware
 *
 */
RpcHttpServer.prototype.middleware = function(req, res) {
    try {
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
        var conn = new RpcHttpConnection(url.parse(address));
        conn.req = req;
        conn.res = res;
        conn.emit('connect');
        this.emit('connection', conn);
        conn.emit('message', req.body);
    } catch (err) {
        res.status(500).send(err);
    }
};


/**
 *
 * start
 *
 */
RpcHttpServer.prototype.start = function(port, secure, logging) {
    dbg.log0('HTTP SERVER start with port:', port);
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
    this.install(app);

    return P.fcall(function() {
            return secure && P.nfcall(pem.createCertificate, {
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
            return P.ninvoke(server, 'listen', port)
                .thenResolve(server);
        });
};
