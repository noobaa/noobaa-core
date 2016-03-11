'use strict';
require('../util/panic');

// load .env file before any other modules so that it will contain
// all the arguments even when the modules are loading.
console.log('loading .env file');
require('dotenv').load();

let _ = require('lodash');
let P = require('../util/promise');
let fs = require('fs');
let util = require('util');
let http = require('http');
let https = require('https');
let express = require('express');
let dbg = require('../util/debug_module')(__filename);
let argv = require('minimist')(process.argv);
let pem = require('../util/pem');
let s3_rest = require('./s3_rest');
var S3Controller = require('./s3_controller');
let cluster = require('cluster');
let numCPUs = require('os').cpus().length;

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
                port: 80,
                ssl_port: 443,
            });
            dbg.log0('Generating selfSigned SSL Certificate...');
            return P.nfcall(pem.createCertificate, {
                days: 365 * 100,
                selfSigned: true
            }).then(certificate => params.certificate = certificate);
        })
        .then(() => app.use(s3_rest(new S3Controller(params))))
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
    return P.nfcall(fs.readFile, 'agent_conf.json')
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
