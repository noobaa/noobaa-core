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
const os = require('os');
const size_utils = require('../util/size_utils');
const numCPUs = os.cpus().length;
const FtpSrv = require('ftp-srv');


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
const net_utils = require('../util/net_utils');

const s3_rest = require('./s3/s3_rest');
const blob_rest = require('./blob/blob_rest');
const lambda_rest = require('./lambda/lambda_rest');
const { FtpFileSystemNB } = require('./ftp/ftp_filesystem');

const ENDPOINT_BLOB_ENABLED = process.env.ENDPOINT_BLOB_ENABLED === 'true';
const ENDPOINT_FTP_ENABLED = process.env.ENDPOINT_FTP_ENABLED === 'true';

// this variable is used to save the dns suffix for virtual hosting of buckets
// it will be updated using update_virtual_host_suffix when getting updated on new base_address if agent
// or when a system store load was done if server
let virtual_host_suffix;
// this "shared" object is used to save the location information on s3 agents 
// it will be updated using update_location_info when getting updated on a change of the pool-id the agent is part of
const location_info = {};

function start_all() {
    dbg.set_process_name('Endpoint');
    if (cluster.isMaster &&
        config.ENDPOINT_FORKS_ENABLED &&
        argv.address &&
        !argv.s3_agent &&
        process.env.container !== 'docker') {
        // Fork workers
        const NUM_OF_FORKS = (os.totalmem() >= (config.SERVER_MIN_REQUIREMENTS.RAM_GB * size_utils.GIGABYTE)) ? numCPUs : 1;
        for (let i = 0; i < NUM_OF_FORKS; i++) {
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
            if (params.message === 'update_base_address') {
                update_virtual_host_suffix(params.base_address);
            } else if (params.message === 'location_info') {
                update_location_info(params.location_info);
            } else if (params.message === 'set_debug') {
                dbg.set_level(params.level, 'core');
            } else if (params.message === 'run_server') {
                update_virtual_host_suffix(params.base_address);
                if (!waiting) {
                    dbg.warn(`got ssl certificates, but already running server 8-O`);
                    return;
                }
                waiting = false;
                dbg.log0(`got ssl certificates. running server`);
                if (params.location_info) update_location_info(params.location_info);
                run_server({
                    s3: true,
                    lambda: true,
                    blob: ENDPOINT_BLOB_ENABLED,
                    certs: params.certs,
                    n2n_agent: true,
                });
            }
        });

        // keep sending STARTED message until a response is returned
        promise_utils.pwhile(() => waiting,
            () => P.resolve()
            .then(() => {
                process.send({ code: 'WAITING_FOR_CERTS' });
                dbg.log0(`waiting for ssl certificates`);
            })
            .delay(30 * 1000));
    } else {
        const system_store = require('../server/system_services/system_store').get_instance(); // eslint-disable-line global-require
        system_store.on('load', () => update_virtual_host_suffix(system_store.data.systems[0] && system_store.data.systems[0].base_address));
        system_store.refresh();
        run_server({
            s3: true,
            lambda: true,
            blob: ENDPOINT_BLOB_ENABLED,
            n2n_agent: true,
        });
    }
}

async function run_server(options) {
    try {
        // Workers can share any TCP connection
        // In this case its a HTTP server
        const config_params = await read_config_file();
        // Just in case part of the information is missing, add default params.
        const { address, port, ssl_port } = _.defaults(argv, config_params, {
            port: process.env.ENDPOINT_PORT || 80,
            ssl_port: process.env.ENDPOINT_SSL_PORT || 443,
        });

        let rpc;
        const addr_url = url.parse(address || '');
        const is_local_address = !address ||
            addr_url.hostname === '127.0.0.1' ||
            addr_url.hostname === 'localhost';
        if (is_local_address) {
            dbg.log0('Initialize S3 RPC with MDServer');
            const md_server = require('../server/md_server'); // eslint-disable-line global-require
            rpc = await md_server.register_rpc();
        } else {
            dbg.log0('Initialize S3 RPC to address', address);
            update_virtual_host_suffix(address);
            rpc = api.new_rpc(address);
        }

        const endpoint_request_handler = create_endpoint_handler(rpc, options);
        if (ENDPOINT_FTP_ENABLED) start_ftp_endpoint(rpc);

        const ssl_cert = options.certs || await ssl_utils.read_ssl_certificate();
        const http_server = http.createServer(endpoint_request_handler);
        const https_server = https.createServer({ ...ssl_cert, honorCipherOrder: true }, endpoint_request_handler);
        dbg.log0('Starting HTTP', port);
        await listen_http(port, http_server);
        dbg.log0('Starting HTTPS', ssl_port);
        await listen_http(ssl_port, https_server);
        dbg.log0('S3 server started successfully');
        if (process.send) process.send({ code: 'STARTED_SUCCESSFULLY' });
    } catch (err) {
        handle_server_error(err);
    }
}


function handle_server_error(err) {
    dbg.error('ENDPOINT FAILED TO START on error:', err.code, err.message, err.stack || err);
    // on error send message to parent process (agent) when running as endpoint agent
    if (process.send) {
        process.send({
            code: 'SRV_ERROR',
            err_code: err.code,
            err_msg: err.message
        });
    } else {
        process.exit(1);
    }
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
    const object_io = new ObjectIO(location_info);
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

        if (virtual_host_suffix) req.virtual_host_suffix = virtual_host_suffix;
        req.object_sdk = new ObjectSDK(rpc.new_client(), object_io);
        return s3_rest_handler(req, res);
    }
}

async function start_ftp_endpoint(rpc) {
    try {
        const port = process.env.FTP_PORT || 21;
        // ftp-srv calls log.debug in some cases. set it to dbg.trace
        dbg.debug = dbg.trace;
        dbg.child = () => dbg;
        const ftp_srv = new FtpSrv(`ftp://0.0.0.0:${port}`, {
            pasv_range: process.env.FTP_PASV_RANGE || "8000-9000",
            anonymous: true,
            log: dbg
        });
        const obj_io = new ObjectIO(location_info);
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

    server.on('error', handle_server_error);

    // This was an attempt to read from the socket in large chunks,
    // but it seems like it has no effect and we still get small chunks
    // server.on('connection', function on_s3_connection(socket) {
    // socket._readableState.highWaterMark = 1024 * 1024;
    // socket.setNoDelay(true);
    // });
}

function update_virtual_host_suffix(base_address) {
    const suffix = base_address && url.parse(base_address).hostname;
    const new_virtual_suffix = net_utils.is_fqdn(suffix) ? '.' + suffix : undefined;
    if (new_virtual_suffix !== virtual_host_suffix) {
        virtual_host_suffix = new_virtual_suffix;
        dbg.log0('The virtual host suffix of this agent was changed to this:', virtual_host_suffix, 'base_address', base_address);
    }
}

function update_location_info(new_location_info) {
    if (!new_location_info) return;
    const keys = Object.keys(location_info);
    for (const key of keys) delete location_info[key];
    Object.assign(location_info, new_location_info);
    dbg.log0('The location information of this agent was changed to this:', location_info);
}


exports.start_all = start_all;
exports.create_endpoint_handler = create_endpoint_handler;
