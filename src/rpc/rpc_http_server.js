'use strict';

let _ = require('lodash');
let P = require('../util/promise');
let http = require('http');
let https = require('https');
let EventEmitter = require('events').EventEmitter;
let dbg = require('../util/debug_module')(__filename);
let pem = require('../util/pem');
let url_utils = require('../util/url_utils');
let RpcHttpConnection = require('./rpc_http');
let express = require('express');
let express_morgan_logger = require('morgan');
let express_body_parser = require('body-parser');
let express_method_override = require('method-override');
let express_compress = require('compression');

/**
 *
 * RpcHttpServer
 *
 */
class RpcHttpServer extends EventEmitter {

    // constructor() { super(); }

    /**
     *
     * install
     *
     */
    install(app_or_server) {
        if (_.isFunction(app_or_server.use)) {
            // install for express app on a route
            app_or_server.use(RpcHttpConnection.BASE_PATH, (req, res, next) => this.middleware(req, res, next));
        } else {
            // install for http server without express app
            app_or_server.on('request', (req, res) => {
                if (_.startsWith(req.url, RpcHttpConnection.BASE_PATH)) {
                    return this.middleware(req, res);
                }
            });
        }
    }


    /**
     *
     * middleware
     *
     */
    middleware(req, res, next) {
        try {
            res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
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


    /**
     *
     * start
     *
     */
    start(options) {
        dbg.log0('HTTP SERVER:', options);
        let app = express();
        if (options.logging) {
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

        return P.fcall(() => {
                return options.secure && P.nfcall(pem.createCertificate, {
                    days: 365 * 100,
                    selfSigned: true
                });
            })
            .then(cert => {
                let http_server = options.secure ?
                    https.createServer({
                        key: cert.serviceKey,
                        cert: cert.certificate
                    }, app) :
                    http.createServer(app);
                return P.ninvoke(http_server, 'listen', options.port)
                    .return(http_server);
            });
    }

}

module.exports = RpcHttpServer;
