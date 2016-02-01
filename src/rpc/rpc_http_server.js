'use strict';

// let _ = require('lodash');
let P = require('../util/promise');
let url = require('url');
let http = require('http');
let https = require('https');
let EventEmitter = require('events').EventEmitter;
let dbg = require('../util/debug_module')(__filename);
let pem = require('../util/pem');
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

    constructor() {
        super();
    }

    /**
     *
     * install
     *
     */
    install(app) {
        app.use(RpcHttpConnection.BASE_PATH, (req, res) => this.middleware(req, res));
    }


    /**
     *
     * middleware
     *
     */
    middleware(req, res) {
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

            let host = req.connection.remoteAddress;
            let port = req.connection.remotePort;
            let proto = req.get('X-Forwarded-Proto') || req.protocol;
            let address = proto + '://' + host + ':' + port;
            let conn = new RpcHttpConnection(url.parse(address));
            conn.req = req;
            conn.res = res;
            conn.emit('connect');
            this.emit('connection', conn);
            conn.emit('message', req.body);
        } catch (err) {
            res.status(500).send(err);
        }
    }


    /**
     *
     * start
     *
     */
    start(port, secure, logging) {
        dbg.log0('HTTP SERVER start with port:', port);
        let app = express();
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

        return P.fcall(() => {
                return secure && P.nfcall(pem.createCertificate, {
                    days: 365 * 100,
                    selfSigned: true
                });
            })
            .then(cert => {
                let server = secure ?
                    https.createServer({
                        key: cert.serviceKey,
                        cert: cert.certificate
                    }, app) :
                    http.createServer(app);
                return P.ninvoke(server, 'listen', port)
                    .thenResolve(server);
            });
    }

}

module.exports = RpcHttpServer;
