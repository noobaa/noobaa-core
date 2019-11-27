/* Copyright (C) 2016 NooBaa */
'use strict';

require('../util/panic');

// load .env file before any other modules so that it will contain
// all the arguments even when the modules are loading.
console.log('loading .env file');
require('../util/dotenv').load();

const http = require('http');
const https = require('https');
const FtpSrv = require('ftp-srv');
const url = require('url');
const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const FuncSDK = require('../sdk/func_sdk');
const ObjectIO = require('../sdk/object_io');
const ObjectSDK = require('../sdk/object_sdk');
const xml_utils = require('../util/xml_utils');
const ssl_utils = require('../util/ssl_utils');
const net_utils = require('../util/net_utils');
const http_utils = require('../util/http_utils');
const s3_rest = require('./s3/s3_rest');
const blob_rest = require('./blob/blob_rest');
const lambda_rest = require('./lambda/lambda_rest');
const { FtpFileSystemNB } = require('./ftp/ftp_filesystem');
const system_store = require('../server/system_services/system_store').get_instance();
const md_server = require('../server/md_server');
const server_rpc = require('../server/server_rpc.js');

const {
    ENDPOINT_BLOB_ENABLED,
    ENDPOINT_FTP_ENABLED,
    ENDPOINT_PORT,
    ENDPOINT_SSL_PORT,
    FTP_PORT,
    LOCATION_INFO,
    VIRTUAL_HOSTS,
    RPC_ROUTER
} = process_env(process.env);

function process_env(env) {
    const virtual_hosts = (env.VIRTUAL_HOSTS || '')
        .split(' ')
        .filter(suffix => net_utils.is_fqdn(suffix))
        .sort();

    return {
        ENDPOINT_BLOB_ENABLE: env.ENDPOINT_BLOB_ENABLED === 'true',
        ENDPOINT_FTP_ENABLED: env.ENDPOINT_FTP_ENABLED === 'true',
        ENDPOINT_PORT: env.ENDPOINT_PORT || 6001,
        ENDPOINT_SSL_PORT: env.ENDPOINT_SSL_PORT || 6443,
        FTP_PORT: env.FTP_PORT || 21,
        LOCATION_INFO: { region: env.REGION || '' },
        VIRTUAL_HOSTS: Object.freeze(virtual_hosts),
        RPC_ROUTER: get_rpc_router(env)
    };
}

function get_rpc_router(env) {
    const base_address = env.MGMT_URL || 'https://127.0.0.1';
    const mgmt_port = env.NOOBAA_MGMT_SERVICE_PORT_MGMT_HTTPS || 8443;
    const md_port = env.NOOBAA_MGMT_SERVICE_PORT_MD_HTTPS || 8444;
    const bg_port = env.NOOBAA_MGMT_SERVICE_PORT_BG_HTTPS || 8445;
    const hosted_agents_port = env.NOOBAA_MGMT_SERVICE_PORT_HOSTED_AGENTS_HTTPS || 8446;
    const { hostname } = url.parse(base_address);

    return {
        default: `wss://${hostname}:${mgmt_port}`,
        md: `wss://${hostname}:${md_port}`,
        bg: `wss://${hostname}:${bg_port}`,
        hosted_agents: `wss://${hostname}:${hosted_agents_port}`,
        master: `wss://${hostname}:${mgmt_port}`,
    };
}

function start_all() {
    dbg.set_process_name('Endpoint');

    run_server({
        s3: true,
        lambda: true,
        blob: ENDPOINT_BLOB_ENABLED,
        n2n_agent: true,
    });
}

async function run_server(options) {
    try {
        server_rpc.rpc.router = RPC_ROUTER;

        // Load a system store instance for the current process and register for changes.
        // We do not wait for it in becasue the result or errors are not relevent at
        // this point (and should not kill the process);
        system_store.load();

        // Register the process as an md_server.
        const rpc = await md_server.register_rpc();

        const endpoint_request_handler = create_endpoint_handler(rpc, options);
        if (ENDPOINT_FTP_ENABLED) start_ftp_endpoint(rpc);

        const ssl_cert = options.certs || await ssl_utils.get_ssl_certificate('S3');
        const http_server = http.createServer(endpoint_request_handler);
        const https_server = https.createServer({ ...ssl_cert, honorCipherOrder: true }, endpoint_request_handler);
        dbg.log0('Starting HTTP', ENDPOINT_PORT);
        await listen_http(ENDPOINT_PORT, http_server);
        dbg.log0('Starting HTTPS', ENDPOINT_SSL_PORT);
        await listen_http(ENDPOINT_SSL_PORT, https_server);
        dbg.log0('S3 server started successfully');
        dbg.log0('Configured Virtual Hosts:', VIRTUAL_HOSTS);

    } catch (err) {
        handle_server_error(err);
    }
}

function handle_server_error(err) {
    dbg.error('ENDPOINT FAILED TO START on error:', err.code, err.message, err.stack || err);
    process.exit(1);
}

function create_endpoint_handler(rpc, options) {
    const s3_rest_handler = options.s3 ? s3_rest : unavailable_handler;
    const blob_rest_handler = options.blob ? blob_rest : unavailable_handler;
    const lambda_rest_handler = options.lambda ? lambda_rest : unavailable_handler;

    if (options.n2n_agent) {
        const signal_client = rpc.new_client();
        const n2n_agent = rpc.register_n2n_agent(signal_client.node.n2n_signal);
        n2n_agent.set_any_rpc_address();
    }
    const object_io = new ObjectIO(LOCATION_INFO);
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

        req.virtual_hosts = VIRTUAL_HOSTS;
        req.object_sdk = new ObjectSDK(rpc.new_client(), object_io);
        return s3_rest_handler(req, res);
    }
}

async function start_ftp_endpoint(rpc) {
    try {
        // ftp-srv calls log.debug in some cases. set it to dbg.trace
        dbg.debug = dbg.trace;
        dbg.child = () => dbg;
        const ftp_srv = new FtpSrv(`ftp://0.0.0.0:${FTP_PORT}`, {
            pasv_range: process.env.FTP_PASV_RANGE || "8000-9000",
            anonymous: true,
            log: dbg
        });
        const obj_io = new ObjectIO(LOCATION_INFO);
        ftp_srv.on('login', (creds, resolve, reject) => {
            dbg.log0(`got a login request from user ${creds.username}`);
            // TODO: create FS and return in resolve. move this to a new file to abstract the use of this package.
            resolve({
                fs: new FtpFileSystemNB({
                    object_sdk: new ObjectSDK(rpc.new_client(), obj_io)
                })
            });
        });

        await ftp_srv.listen();
    } catch (err) {
        console.log(`got error from ftp_srv.listen`, err);
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

    server.on('error', handle_server_error);

    // This was an attempt to read from the socket in large chunks,
    // but it seems like it has no effect and we still get small chunks
    // server.on('connection', function on_s3_connection(socket) {
    // socket._readableState.highWaterMark = 1024 * 1024;
    // socket.setNoDelay(true);
    // });
}

exports.start_all = start_all;
exports.create_endpoint_handler = create_endpoint_handler;
