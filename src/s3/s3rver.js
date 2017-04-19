/* Copyright (C) 2016 NooBaa */
'use strict';

require('../util/panic');

// load .env file before any other modules so that it will contain
// all the arguments even when the modules are loading.
console.log('loading .env file');
require('../util/dotenv').load();

const _ = require('lodash');
const fs = require('fs');
const url = require('url');
const util = require('util');
const argv = require('minimist')(process.argv);
const http = require('http');
const https = require('https');
const express = require('express');
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;
const path = require('path');

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const pem = require('../util/pem');
const api = require('../api');
const config = require('../../config');

const s3_rest = require('./s3_rest');
const azure_rest = require('./azure_rest');
const S3Controller = require('./s3_controller');
const lambda_rest = require('../lambda/lambda_rest');
const LambdaController = require('../lambda/lambda_controller');
dbg.set_process_name('S3rver');

function start_all() {
    if (cluster.isMaster && config.S3_FORKS_ENABLED && argv.address) {
        // Fork workers
        for (let i = 0; i < numCPUs; i++) {
            console.warn('Spawning S3 Server', i + 1);
            cluster.fork();
        }
        cluster.on('exit', function(worker, code, signal) {
            console.log('worker ' + worker.process.pid + ' died');
            // fork again on exit
            cluster.fork();
        });
    } else {
        let azure = Boolean(argv.azure);
        run_server({
            azure,
            s3: true,
            lambda: true
        });
    }
}

function run_server(options) {

    // Workers can share any TCP connection
    // In this case its a HTTP server
    let params = argv;
    let app = express();

    // copied from s3rver. not sure why. but copy.
    app.disable('x-powered-by');

    read_config_file()
        .then(config_params => {
            // Just in case part of the information is missing, add default params.
            _.defaults(params, config_params, {
                port: process.env.S3_PORT || 80,
                ssl_port: process.env.S3_SSL_PORT || 443,
            });
            dbg.log0('certificate location:', path.join('/etc', 'private_ssl_path', 'server.key'));
            if (fs.existsSync(path.join('/etc', 'private_ssl_path', 'server.key')) &&
                fs.existsSync(path.join('/etc', 'private_ssl_path', 'server.crt'))) {
                dbg.log0('Using local certificate');
                var local_certificate = {
                    serviceKey: fs.readFileSync(path.join('/etc', 'private_ssl_path', 'server.key')),
                    certificate: fs.readFileSync(path.join('/etc', 'private_ssl_path', 'server.crt'))
                };
                return local_certificate;
            } else {

                dbg.log0('Generating self signed certificate');
                return P.fromCallback(callback => pem.createCertificate({
                    days: 365 * 100,
                    selfSigned: true
                }, callback));
            }
        })
        .then(certificate => {
            params.certificate = certificate;
            const addr_url = url.parse(params.address || '');
            const is_local_address = !params.address ||
                addr_url.hostname === '127.0.0.1' ||
                addr_url.hostname === 'localhost';
            if (is_local_address) {
                dbg.log0('Initialize S3 RPC with MDServer');
                const md_server = require('../server/md_server'); // eslint-disable-line global-require
                return md_server.register_rpc();
            } else {
                dbg.log0('Initialize S3 RPC to address', params.address);
                return api.new_rpc(params.address);
            }
        })
        .then(rpc => {
            if (options && options.lambda) {
                dbg.log0('starting lambda controller');
                app.use('/2015-03-31/functions/', lambda_rest(new LambdaController(rpc)));
            }
            if (options && options.s3) {
                dbg.log0('starting s3 controller');
                let s3_controller = new S3Controller(rpc);
                if (options.azure) {
                    dbg.log0('using Azure rest API');
                    app.use(azure_rest(s3_controller));
                }
                app.use(s3_rest(s3_controller));
            }
        })
        .then(() => dbg.log0('Starting HTTP', params.port))
        .then(() => listen_http(params.port, http.createServer(app)))
        .then(() => dbg.log0('Starting HTTPS', params.ssl_port))
        .then(() => listen_http(params.ssl_port, https.createServer({
            key: params.certificate.serviceKey,
            cert: params.certificate.certificate
        }, app)))
        .catch(err => {
            dbg.log0('S3RVER FAILED TO START', err.stack || err);
            process.exit();
        });
}

function read_config_file() {
    return fs.readFileAsync('agent_conf.json')
        .then(data => {
            let agent_conf = JSON.parse(data);
            dbg.log0('using agent_conf.json', util.inspect(agent_conf));
            return agent_conf;
        })
        .catch(err => {
            dbg.log0('cannot find/parse agent_conf.json file.', err.message);
            return {};
        });
}

function listen_http(port, server) {
    return new P((resolve, reject) => {
        setup_s3_http_server(server);
        server.listen(port, err => {
            if (err) {
                dbg.error('S3RVER FAILED to listen', err);
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

function setup_s3_http_server(server) {
    // Handle 'Expect' header different than 100-continue to conform with AWS.
    // Consider any expect value as if the client is expecting 100-continue.
    // See https://github.com/ceph/s3-tests/blob/master/s3tests/functional/test_headers.py:
    // - test_object_create_bad_expect_mismatch()
    // - test_object_create_bad_expect_empty()
    // - test_object_create_bad_expect_none()
    // - test_object_create_bad_expect_unreadable()
    // See https://nodejs.org/api/http.html#http_event_checkexpectation
    server.on('checkExpectation', function on_s3_check_expectation(req, res) {
        res.writeContinue();
        server.emit('request', req, res);
    });

    // See https://nodejs.org/api/http.html#http_event_clienterror
    server.on('clientError', function on_s3_client_error(err, socket) {

        // On parsing errors we reply 400 Bad Request to conform with AWS
        // These errors come from the nodejs native http parser.
        if (typeof err.code === 'string' &&
            err.code.startsWith('HPE_INVALID_') &&
            err.bytesParsed > 0) {
            console.error('S3 CLIENT ERROR - REPLY WITH BAD REQUEST', err);
            socket.write('HTTP/1.1 400 Bad Request\r\n');
            socket.write(`Date: ${new Date().toUTCString()}\r\n`);
            socket.write('Connection: close\r\n');
            socket.write('Content-Length: 0\r\n');
            socket.end('\r\n');
        }

        // in any case we destroy the socket
        socket.destroy();
    });

    // This was an attempt to read from the socket in large chunks,
    // but it seems like it has no effect and we still get small chunks
    // server.on('connection', function on_s3_connection(socket) {
    // socket._readableState.highWaterMark = 1024 * 1024;
    // socket.setNoDelay(true);
    // });
}


exports.start_all = start_all;
