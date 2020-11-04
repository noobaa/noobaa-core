/* Copyright (C) 2016 NooBaa */
'use strict';

// const _ = require('lodash');
const http = require('http');
const https = require('https');
const events = require('events');

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const url_utils = require('../util/url_utils');
const ssl_utils = require('../util/ssl_utils');
const RpcHttpConnection = require('./rpc_http');

/**
 *
 * RpcHttpServer
 *
 */
class RpcHttpServer extends events.EventEmitter {

    /**
     * install for express app on a route
     */
    install_on_express(app) {
        return app.use(RpcHttpConnection.BASE_PATH, (req, res, next) => this.handle_request(req, res));
    }

    /**
     * install for http server without express app
     */
    install_on_server(server, default_handler) {
        return server.on('request', (req, res) => {
            if (req.url.startsWith(RpcHttpConnection.BASE_PATH)) return this.handle_request(req, res);
            if (default_handler) return default_handler(req, res);
            dbg.warn('unrecognized http request (responding 404)', req.method, req.url, req.headers);
            res.statusCode = 404;
            res.end();
        });
    }

    /**
     * start_server
     */
    start_server(options) {
        const port = parseInt(options.port, 10);
        const secure = options.protocol === 'https:' || options.protocol === 'wss:';
        const logging = options.logging;
        dbg.log0('HTTP SERVER:', 'port', port, 'secure', secure, 'logging', logging);

        const server = secure ?
            https.createServer({ ...ssl_utils.generate_ssl_certificate(), honorCipherOrder: true }) :
            http.createServer();
        this.install_on_server(server, options.default_handler);
        return P.fromCallback(callback => server.listen(port, callback))
            .then(() => server);
    }

    /**
     * handle_request
     */
    handle_request(req, res) {
        try {
            res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Content-MD5,Authorization');
            res.setHeader('Access-Control-Allow-Origin', '*');
            // note that browsers will not allow origin=* with credentials
            // but anyway we allow it by the agent server.
            res.setHeader('Access-Control-Allow-Credentials', true);
            if (req.method === 'OPTIONS') {
                res.statusCode = 200;
                res.end();
                return;
            }

            let host = req.connection.remoteAddress;
            let port = req.connection.remotePort;
            let proto = req.connection.ssl ? 'https' : 'http';
            let address = proto + '://' + host + ':' + port;
            let conn = new RpcHttpConnection(url_utils.quick_parse(address));
            conn.req = req;
            conn.res = res;
            conn.emit('connect');
            this.emit('connection', conn);
            conn.handle_http_request();
        } catch (err) {
            console.error('HTTP MIDDLEWARE ERROR', err.stack);
            res.statusCode = 500;
            res.end(err);
        }
    }

}

module.exports = RpcHttpServer;
