'use strict';

require('../util/panic');

// load .env file before any other modules so that it will contain
// all the arguments even when the modules are loading.
console.log('loading .env file');
require('dotenv').load();

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
const s3_rest = require('./s3_rest');
const S3Controller = require('./s3_controller');

dbg.set_process_name('S3rver');

if (cluster.isMaster && process.env.S3_CLUSTER_DISABLED !== 'true') {
    // Fork workers
    for (let i = 0; i < numCPUs; i++) {
        console.warn('Spawning S3 Server', i + 1);
        cluster.fork();
    }
    cluster.on('exit', function(worker, code, signal) {
        console.log('worker ' + worker.process.pid + ' died');
    });
} else {
    run_server();
}


function run_server() {

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
                const md_server = require('../server/md_server');
                return md_server.register_rpc();
            } else {
                dbg.log0('Initialize S3 RPC to address', params.address);
                return api.new_rpc(params.address);
            }
        })
        .then(s3_rpc => app.use(s3_rest(new S3Controller(s3_rpc))))
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
        server.on('connection', connection_setup);
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

function connection_setup(socket) {
    // this is an attempt to read from the socket in large chunks,
    // but it seems like it has no effect and we still get small chunks
    // socket._readableState.highWaterMark = 1024 * 1024;
    // socket.setNoDelay(true);
}
