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
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;

const P = require('../util/promise');
const promise_utils = require('../util/promise_utils');
const dbg = require('../util/debug_module')(__filename);
const api = require('../api');
const config = require('../../config');
const FuncSDK = require('../sdk/func_sdk');
const ObjectIO = require('../sdk/object_io');
const ObjectSDK = require('../sdk/object_sdk');
const xml_utils = require('../util/xml_utils');
const ssl_utils = require('../util/ssl_utils');
const http_utils = require('../util/http_utils');

const s3_rest = require('./s3/s3_rest');
const blob_rest = require('./blob/blob_rest');
const lambda_rest = require('./lambda/lambda_rest');

const ENDPOINT_BLOB_ENABLED = process.env.ENDPOINT_BLOB_ENABLED === 'true';

function start_all() {
    dbg.set_process_name('Endpoint');
    if (cluster.isMaster && config.ENDPOINT_FORKS_ENABLED && argv.address) {
        // Fork workers
        for (let i = 0; i < numCPUs; i++) {
            console.warn('Spawning Endpoint Server', i + 1);
            cluster.fork();
        }
        cluster.on('exit', function(worker, code, signal) {
            console.log('worker ' + worker.process.pid + ' died');
            // fork again on exit
            cluster.fork();
        });
    } else if (argv.s3_agent) {
        // for s3 agents, wait to get ssl certificates before running the server
        if (!process.send) {
            dbg.error('process.send function is undefiend. this process was probably not forked with ipc.');
            process.exit(1);
        }

        let waiting = true;

        process.on('message', params => {
            if (waiting) {
                waiting = false;
                dbg.log0(`got ssl certificates. running server`);
                run_server({
                    s3: true,
                    lambda: true,
                    blob: ENDPOINT_BLOB_ENABLED,
                    certs: params.certs,
                    node_id: params.node_id,
                    host_id: params.host_id
                });
            }
        });

        // keep sending STARTED message until a response is returned
        promise_utils.pwhile(() => waiting,
            () => P.resolve()
            .then(() => {
                process.send({ code: 'STARTED' });
                dbg.log0(`waiting for ssl certificates`);
            })
            .delay(30 * 1000));
    } else {
        run_server({
            s3: true,
            lambda: true,
            blob: ENDPOINT_BLOB_ENABLED,
        });
    }
}

function run_server(options) {

    // Workers can share any TCP connection
    // In this case its a HTTP server
    let params = argv;
    let endpoint_request_handler;

    read_config_file()
        .then(config_params => {
            // Just in case part of the information is missing, add default params.
            _.defaults(params, config_params, {
                port: process.env.ENDPOINT_PORT || 80,
                ssl_port: process.env.ENDPOINT_SSL_PORT || 443,
            });
            return options.certs || ssl_utils.read_ssl_certificate();
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
            endpoint_request_handler = create_endpoint_handler(rpc, options);
        })
        .then(() => dbg.log0('Starting HTTP', params.port))
        .then(() => listen_http(params.port, http.createServer(endpoint_request_handler)))
        .then(() => dbg.log0('Starting HTTPS', params.ssl_port))
        .then(() => listen_http(params.ssl_port, https.createServer(params.certificate, endpoint_request_handler)))
        .catch(err => {
            dbg.log0('ENDPOINT FAILED TO START', err.stack || err);
            process.exit();
        });
}

function create_endpoint_handler(rpc, options) {
    const s3_rest_handler = options.s3 ? s3_rest : unavailable_handler;
    const blob_rest_handler = options.blob ? blob_rest : unavailable_handler;
    const lambda_rest_handler = options.lambda ? lambda_rest : unavailable_handler;

    // setting up rpc
    const signal_client = rpc.new_client();
    const n2n_agent = rpc.register_n2n_agent(signal_client.node.n2n_signal);
    n2n_agent.set_any_rpc_address();
    const object_io = new ObjectIO(options.node_id, options.host_id);
    return endpoint_request_handler;

    function endpoint_request_handler(req, res) {
        // generate request id, this is lighter than uuid
        req.request_id = `${
            Date.now().toString(36)
        }-${
            process.hrtime()[1].toString(36)
        }-${
            Math.trunc(Math.random() * 65536).toString(36)
        }`;
        http_utils.parse_url_query(req);

        if (req.url.startsWith('/2015-03-31/functions')) {
            req.func_sdk = new FuncSDK(rpc.new_client());
            return lambda_rest_handler(req, res);
        }

        if (req.headers['x-ms-version']) {
            req.object_sdk = new ObjectSDK(rpc.new_client(), object_io);
            return blob_rest_handler(req, res);
        }

        req.object_sdk = new ObjectSDK(rpc.new_client(), object_io);
        return s3_rest_handler(req, res);
    }
}

function unavailable_handler(req, res) {
    res.statusCode = 500; // Service Unavailable
    const reply = xml_utils.encode_xml({
        Error: {
            Code: 500,
            Message: 'This server\'s configuration disabled the requested service handler',
            Resource: req.url,
        }
    });
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Length', Buffer.byteLength(reply));
    res.end(reply);
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
        setup_http_server(server);
        server.listen(port, err => {
            if (err) {
                dbg.error('ENDPOINT FAILED to listen', err);
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

function setup_http_server(server) {
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
            console.error('ENDPOINT CLIENT ERROR - REPLY WITH BAD REQUEST', err);
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
exports.create_endpoint_handler = create_endpoint_handler;
