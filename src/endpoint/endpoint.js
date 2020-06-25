/* Copyright (C) 2016 NooBaa */
'use strict';

// load .env file before any other modules so that it will contain
// all the arguments even when the modules are loading.
console.log('loading .env file');
require('../util/dotenv').load();
require('../util/panic');
require('../util/fips');

const http = require('http');
const https = require('https');
const FtpSrv = require('ftp-srv');
const os = require('os');
const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const FuncSDK = require('../sdk/func_sdk');
const ObjectIO = require('../sdk/object_io');
const ObjectSDK = require('../sdk/object_sdk');
const xml_utils = require('../util/xml_utils');
const ssl_utils = require('../util/ssl_utils');
const net_utils = require('../util/net_utils');
const http_utils = require('../util/http_utils');
const addr_utils = require('../util/addr_utils');
const promise_utils = require('../util/promise_utils');
const os_utils = require('../util/os_utils');
const s3_rest = require('./s3/s3_rest');
const blob_rest = require('./blob/blob_rest');
const lambda_rest = require('./lambda/lambda_rest');
const { FtpFileSystemNB } = require('./ftp/ftp_filesystem');
const system_store = require('../server/system_services/system_store');
const md_server = require('../server/md_server');
const auth_server = require('../server/common_services/auth_server');
const server_rpc = require('../server/server_rpc');
const { ENDPOINT_MONITOR_INTERVAL } = require('../../config');

const {
    ENDPOINT_BLOB_ENABLED,
    ENDPOINT_FTP_ENABLED,
    ENDPOINT_PORT,
    ENDPOINT_SSL_PORT,
    FTP_PORT,
    LOCATION_INFO,
    VIRTUAL_HOSTS,
    RPC_ROUTER,
    ENDPOINT_GROUP_ID,
    LOCAL_MD_SERVER,
    LOCAL_N2N_AGENT
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
        RPC_ROUTER: get_rpc_router(env),
        ENDPOINT_GROUP_ID: env.ENDPOINT_GROUP_ID || 'default-endpoint-group',
        LOCAL_MD_SERVER: env.LOCAL_MD_SERVER === "true",
        LOCAL_N2N_AGENT: env.LOCAL_N2N_AGENT === "true"
    };
}

function get_rpc_router(env) {
    const hostname = '127.0.0.1';
    const ports = addr_utils.get_default_ports();

    // for dev (when env.MD_ADDR is not set) we increment md port to
    // make it route to the s3 endpoints port rather than the default web server.
    ports.md += 1;

    return {
        default: env.MGMT_ADDR || addr_utils.format_base_address(hostname, ports.mgmt),
        md: env.MD_ADDR || addr_utils.format_base_address(hostname, ports.md),
        bg: env.BG_ADDR || addr_utils.format_base_address(hostname, ports.bg),
        hosted_agents: env.HOSTED_AGENTS_ADDR || addr_utils.format_base_address(hostname, ports.hosted_agents),
        master: env.MGMT_ADDR || addr_utils.format_base_address(hostname, ports.mgmt),
    };
}

function start_all() {
    dbg.set_process_name('Endpoint');

    run_server({
        s3: true,
        lambda: true,
        blob: ENDPOINT_BLOB_ENABLED,
        ftp: ENDPOINT_FTP_ENABLED,
        md_server: LOCAL_MD_SERVER,
        n2n_agent: LOCAL_N2N_AGENT
    });
}

async function run_server(options) {
    try {
        const rpc = server_rpc.rpc;
        rpc.router = RPC_ROUTER;

        // Register the process as an md_server if needed.
        if (options.md_server) {
            // Load a system store instance for the current process and register for changes.
            // We do not wait for it in becasue the result or errors are not relevent at
            // this point (and should not kill the process);
            system_store.get_instance().load();

            // Register the process as an md_server.
            await md_server.register_rpc();
        }

        const auth_token = await get_auth_token(process.env);
        const internal_rpc_client = server_rpc.rpc.new_client({ auth_token });

        const endpoint_request_handler = create_endpoint_handler(rpc, internal_rpc_client, options);
        if (options.ftp) start_ftp_endpoint(rpc, internal_rpc_client);

        const ssl_cert = options.certs || await ssl_utils.get_ssl_certificate('S3');
        const http_server = http.createServer(endpoint_request_handler);
        const https_server = https.createServer({ ...ssl_cert, honorCipherOrder: true }, endpoint_request_handler);
        dbg.log0('Starting HTTP', ENDPOINT_PORT);
        await listen_http(ENDPOINT_PORT, http_server);
        dbg.log0('Starting HTTPS', ENDPOINT_SSL_PORT);
        await listen_http(ENDPOINT_SSL_PORT, https_server);
        dbg.log0('S3 server started successfully');
        dbg.log0('Configured Virtual Hosts:', VIRTUAL_HOSTS);

        // Start a monitor to send periodic endpoint reports about endpoint usage.
        start_monitor(internal_rpc_client);

    } catch (err) {
        handle_server_error(err);
    }
}

async function get_auth_token(env) {
    if (env.NOOBAA_AUTH_TOKEN) {
        return env.NOOBAA_AUTH_TOKEN;

    } else if (env.JWT_SECRET && LOCAL_MD_SERVER) {
        const system_store_inst = system_store.get_instance();
        await promise_utils.wait_until(() =>
            system_store_inst.is_finished_initial_load
        );
        const system = system_store_inst.data.systems[0];
        return auth_server.make_auth_token({
            system_id: system._id,
            account_id: system.owner._id,
            role: 'admin'
        });

    } else {
        throw new Error('NooBaa auth token is unavailable');
    }
}

async function start_monitor(internal_rpc_client) {
    let start_time = process.hrtime.bigint() / 1000n;
    let base_cpu_time = process.cpuUsage();

    dbg.log0('Endpoint monitor started');
    for (;;) {
        try {
            await promise_utils.delay_unblocking(ENDPOINT_MONITOR_INTERVAL);
            const end_time = process.hrtime.bigint() / 1000n;
            const cpu_time = process.cpuUsage();
            const elap_cpu_time = (cpu_time.system + cpu_time.user) - (base_cpu_time.system + base_cpu_time.user);
            const cpu_usage = elap_cpu_time / Number((end_time - start_time));
            const rest_usage = s3_rest.consume_usage_report();
            const group_name = ENDPOINT_GROUP_ID;
            const hostname = os.hostname();

            dbg.log0('Sending endpoint report:', { group_name, hostname });
            await internal_rpc_client.object.add_endpoint_report({
                timestamp: Date.now(),
                group_name,
                hostname,
                cpu: {
                    count: os_utils.get_cpus(),
                    usage: cpu_usage
                },
                memory: {
                    total: os_utils.get_memory(),
                    used: process.memoryUsage().rss,
                },
                s3_ops: {
                    usage: rest_usage.s3_usage_info,
                    errors: rest_usage.s3_errors_info
                },
                bandwidth: [
                    ...rest_usage.bandwidth_usage_info.values()
                ]
            });

            // save the current values as base for next iteration.
            start_time = end_time;
            base_cpu_time = cpu_time;
        } catch (err) {
            dbg.error('Could not submit endpoint monitor report, got:', err);
        }
    }
}

function handle_server_error(err) {
    dbg.error('ENDPOINT FAILED TO START on error:', err.code, err.message, err.stack || err);
    process.exit(1);
}

function create_endpoint_handler(rpc, internal_rpc_client, options) {
    const s3_rest_handler = options.s3 ? s3_rest.handler : unavailable_handler;
    const blob_rest_handler = options.blob ? blob_rest : unavailable_handler;
    const lambda_rest_handler = options.lambda ? lambda_rest : unavailable_handler;

    if (options.n2n_agent) {
        const signal_client = rpc.new_client({ auth_token: server_rpc.client.options.auth_token });
        const n2n_agent = rpc.register_n2n_agent(((...args) => signal_client.node.n2n_signal(...args)));
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
            req.object_sdk = new ObjectSDK(rpc.new_client(), internal_rpc_client, object_io);
            return blob_rest_handler(req, res);
        }

        req.virtual_hosts = VIRTUAL_HOSTS;
        req.object_sdk = new ObjectSDK(rpc.new_client(), internal_rpc_client, object_io);
        return s3_rest_handler(req, res);
    }
}

async function start_ftp_endpoint(rpc, internal_rpc_client) {
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
                    object_sdk: new ObjectSDK(rpc.new_client(), internal_rpc_client, obj_io)
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
