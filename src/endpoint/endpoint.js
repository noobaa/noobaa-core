/* Copyright (C) 2016 NooBaa */
'use strict';

// load .env file before any other modules so that it will contain
// all the arguments even when the modules are loading.
require('../util/dotenv').load();
require('../util/panic');
require('../util/fips');

const dbg = require('../util/debug_module')(__filename);
if (!dbg.get_process_name()) dbg.set_process_name('Endpoint');

const util = require('util');
const http = require('http');
const https = require('https');
const os = require('os');

const P = require('../util/promise');
const config = require('../../config');
const s3_rest = require('./s3/s3_rest');
const blob_rest = require('./blob/blob_rest');
const sts_rest = require('./sts/sts_rest');
const iam_rest = require('./iam/iam_rest');
const lambda_rest = require('./lambda/lambda_rest');
const endpoint_utils = require('./endpoint_utils');
const FuncSDK = require('../sdk/func_sdk');
const StsSDK = require('../sdk/sts_sdk');
const ObjectIO = require('../sdk/object_io');
const ObjectSDK = require('../sdk/object_sdk');
const xml_utils = require('../util/xml_utils');
const ssl_utils = require('../util/ssl_utils');
const net_utils = require('../util/net_utils');
const addr_utils = require('../util/addr_utils');
const fork_utils = require('../util/fork_utils');
const md_server = require('../server/md_server');
const server_rpc = require('../server/server_rpc');
const debug_config = require('../util/debug_config');
const auth_server = require('../server/common_services/auth_server');
const system_store = require('../server/system_services/system_store');
const background_scheduler = require('../util/background_scheduler').get_instance();
const endpoint_stats_collector = require('../sdk/endpoint_stats_collector');
const { NamespaceMonitor } = require('../server/bg_services/namespace_monitor');
const { SemaphoreMonitor } = require('../server/bg_services/semaphore_monitor');
const prom_reporting = require('../server/analytic_services/prometheus_reporting');
const { PersistentLogger } = require('../util/persistent_logger');
const NoobaaEvent = require('../manage_nsfs/manage_nsfs_events_utils').NoobaaEvent;
const cluster = /** @type {import('node:cluster').Cluster} */ (
    /** @type {unknown} */ (require('node:cluster'))
);

if (process.env.NOOBAA_LOG_LEVEL) {
    const dbg_conf = debug_config.get_debug_config(process.env.NOOBAA_LOG_LEVEL);
    dbg_conf.endpoint.map(module => dbg.set_module_level(dbg_conf.level, module));
}

const new_umask = process.env.NOOBAA_ENDPOINT_UMASK || 0o000;
const old_umask = process.umask(new_umask);
let fork_count;
dbg.log0('endpoint: replacing old umask: ', old_umask.toString(8), 'with new umask: ', new_umask.toString(8));

/**
 * @typedef {http.IncomingMessage & {
 *  object_sdk?: ObjectSDK;
 *  func_sdk?: FuncSDK;
 *  sts_sdk?: StsSDK;
 *  virtual_hosts?: readonly string[];
 *  bucket_logger?: PersistentLogger;
 *  notification_logger?: PersistentLogger;
 * }} EndpointRequest
 */

/**
 * @typedef {(
 *  req: EndpointRequest,
 *  res: http.ServerResponse
 * ) => void | Promise<void>} EndpointHandler 
 */

/**
 * @typedef {{
 *  http_port?: number;
 *  https_port?: number;
 *  https_port_sts?: number;
 *  https_port_iam?: number;
 *  metrics_port?: number;
 *  nsfs_config_root?: string;
 *  init_request_sdk?: EndpointHandler;
 *  forks?: number;
 * }} EndpointOptions
 */

// An internal function to prevent code duplication
async function create_https_server(ssl_cert_info, honorCipherOrder, endpoint_handler) {
    const ssl_options = {...ssl_cert_info.cert, honorCipherOrder: honorCipherOrder};
    return https.createServer(ssl_options, endpoint_handler);
}

/**
 * @param {EndpointOptions} options
 */
/* eslint-disable max-statements */
async function main(options = {}) {
    let bucket_logger;
    let notification_logger;
    try {
        // setting process title needed for letting GPFS to identify the noobaa endpoint processes see issue #8039.
        if (config.ENDPOINT_PROCESS_TITLE) {
            process.title = config.ENDPOINT_PROCESS_TITLE;
        }

        // the primary just forks and returns, workers will continue to serve
        fork_count = options.forks ?? config.ENDPOINT_FORKS;
        const metrics_port = options.metrics_port || config.EP_METRICS_SERVER_PORT;
        if (fork_utils.start_workers(metrics_port, fork_count)) return;

        const http_port = options.http_port || config.ENDPOINT_PORT;
        const https_port = options.https_port || config.ENDPOINT_SSL_PORT;
        const https_port_sts = options.https_port_sts || Number(process.env.ENDPOINT_SSL_PORT_STS) || 7443;
        const https_port_iam = options.https_port_iam || config.ENDPOINT_SSL_IAM_PORT;
        const endpoint_group_id = process.env.ENDPOINT_GROUP_ID || 'default-endpoint-group';

        const virtual_hosts = Object.freeze(
            config.VIRTUAL_HOSTS
            .split(' ')
            .filter(suffix => net_utils.is_fqdn(suffix))
            .sort()
        );
        const location_info = Object.freeze({
            region: process.env.REGION || '',
        });

        dbg.log0('Configured Virtual Hosts:', virtual_hosts);
        dbg.log0('Configured Location Info:', location_info);

        const node_name = process.env.NODE_NAME || os.hostname();
        bucket_logger = config.BUCKET_LOG_TYPE === 'PERSISTENT' &&
            new PersistentLogger(config.PERSISTENT_BUCKET_LOG_DIR, config.PERSISTENT_BUCKET_LOG_NS + '_' + node_name, {
                locking: 'SHARED',
                poll_interval: config.NSFS_GLACIER_LOGS_POLL_INTERVAL,
            });

        notification_logger = config.NOTIFICATION_LOG_DIR &&
            new PersistentLogger(config.NOTIFICATION_LOG_DIR, config.NOTIFICATION_LOG_NS + '_' + node_name, {
                locking: 'SHARED',
                poll_interval: config.NSFS_GLACIER_LOGS_POLL_INTERVAL,
            });

        process.on('warning', e => dbg.warn(e.stack));

        let internal_rpc_client;
        let object_io;

        let init_request_sdk = options.init_request_sdk;
        if (!init_request_sdk) {

            const rpc = server_rpc.rpc;
            rpc.router = get_rpc_router(process.env);

            // Register the process as an md_server if needed.
            if (process.env.LOCAL_MD_SERVER === 'true') {
                dbg.log0('Starting local MD server');
                // Load a system store instance for the current process and register for changes.
                // We do not wait for it in becasue the result or errors are not relevent at
                // this point (and should not kill the process);
                system_store.get_instance().load();
                // Register the process as an md_server.
                await md_server.register_rpc();
            }

            if (process.env.LOCAL_N2N_AGENT === 'true') {
                dbg.log0('Starting local N2N agent');
                const signal_client = rpc.new_client({ auth_token: server_rpc.client.options.auth_token });
                const n2n_agent = rpc.register_n2n_agent(((...args) => signal_client.node.n2n_signal(...args)));
                n2n_agent.set_any_rpc_address();
            }
            object_io = new ObjectIO(location_info);

            internal_rpc_client = rpc.new_client({
                auth_token: await get_auth_token(process.env)
            });

            init_request_sdk = create_init_request_sdk(rpc, internal_rpc_client, object_io);
        }

        const endpoint_request_handler = create_endpoint_handler(init_request_sdk, virtual_hosts, /*is_sts?*/ false,
            bucket_logger, notification_logger);
        const endpoint_request_handler_sts = create_endpoint_handler(init_request_sdk, virtual_hosts, /*is_sts?*/ true);

        const ssl_cert_info = await ssl_utils.get_ssl_cert_info('S3', options.nsfs_config_root);
        const https_server = await create_https_server(ssl_cert_info, true, endpoint_request_handler);
        const sts_ssl_cert_info = await ssl_utils.get_ssl_cert_info('STS');
        const https_server_sts = await create_https_server(sts_ssl_cert_info, true, endpoint_request_handler_sts);

        ssl_cert_info.on('update', updated_ssl_cert_info => {
            dbg.log0("Setting updated S3 ssl certs for endpoint.");
            const updated_ssl_options = { ...updated_ssl_cert_info.cert, honorCipherOrder: true };
            https_server.setSecureContext(updated_ssl_options);
        });
        sts_ssl_cert_info.on('update', updated_sts_ssl_cert_info => {
            dbg.log0("Setting updated STS ssl certs for endpoint.");
            const updated_ssl_options = { ...updated_sts_ssl_cert_info.cert, honorCipherOrder: true };
            https_server_sts.setSecureContext(updated_ssl_options);
        });
        if (options.nsfs_config_root && !config.ALLOW_HTTP) {
            dbg.warn('HTTP is not allowed for NC NSFS.');
        } else {
            const http_server = http.createServer(endpoint_request_handler);
            if (http_port > 0) {
                dbg.log0('Starting S3 HTTP', http_port);
                await listen_http(http_port, http_server);
                dbg.log0('Started S3 HTTP successfully');
            }
        }
        if (https_port > 0) {
            dbg.log0('Starting S3 HTTPS', https_port);
            await listen_http(https_port, https_server);
            dbg.log0('Started S3 HTTPS successfully');
        }
        if (https_port_sts > 0) {
            dbg.log0('Starting STS HTTPS', https_port_sts);
            await listen_http(https_port_sts, https_server_sts);
            dbg.log0('Started STS HTTPS successfully');
        }
        if (https_port_iam > 0) {
            dbg.log0('Starting IAM HTTPS', https_port_iam);
            const endpoint_request_handler_iam = create_endpoint_handler_iam(init_request_sdk);
            // NOTE: The IAM server currently uses the S3 server's certificate. This *will* cause route failures in Openshift.
            // TODO: Generate, mount and utilize an appropriate IAM certificate once the service and route are implemented
            const https_server_iam = await create_https_server(ssl_cert_info, true, endpoint_request_handler_iam);
            await listen_http(https_port_iam, https_server_iam);
            dbg.log0('Started IAM HTTPS successfully');
        }
        if (metrics_port > 0 && cluster.isPrimary) {
            dbg.log0('Starting metrics server', metrics_port);
            await prom_reporting.start_server(metrics_port, false);
            dbg.log0('Started metrics server successfully');
        }
        // TODO: currently NC NSFS deployments don't have internal_rpc_client nor db, 
        // there for namespace monitor won't be registered
        if (internal_rpc_client && config.NAMESPACE_MONITOR_ENABLED) {
            endpoint_stats_collector.instance().set_rpc_client(internal_rpc_client);

            // Register a bg monitor on the endpoint
            background_scheduler.register_bg_worker(new NamespaceMonitor({
                name: 'namespace_fs_monitor',
                client: internal_rpc_client,
                should_monitor: nsr => Boolean(nsr.nsfs_config),
            }));
        }

        if (config.ENABLE_SEMAPHORE_MONITOR) {
            background_scheduler.register_bg_worker(new SemaphoreMonitor({
                name: 'semaphore_monitor',
                object_io: object_io,
            }));
        }
        //noobaa started
        new NoobaaEvent(NoobaaEvent.NOOBAA_STARTED).create_event(undefined, undefined, undefined);
        // Start a monitor to send periodic endpoint reports about endpoint usage.
        start_monitor(internal_rpc_client, endpoint_group_id);
    } catch (err) {
        //noobaa crashed event
        new NoobaaEvent(NoobaaEvent.ENDPOINT_CRASHED).create_event(undefined, undefined, err);
        handle_server_error(err);
    } finally {
        if (bucket_logger) bucket_logger.close();
    }
}

/**
 * @param {EndpointHandler} init_request_sdk
 * @param {readonly string[]} virtual_hosts
 * @returns {EndpointHandler}
 */
function create_endpoint_handler(init_request_sdk, virtual_hosts, sts, logger, notification_logger) {
    const blob_rest_handler = process.env.ENDPOINT_BLOB_ENABLED === 'true' ? blob_rest : unavailable_handler;
    const lambda_rest_handler = config.DB_TYPE === 'mongodb' ? lambda_rest : unavailable_handler;

    /** @type {EndpointHandler} */
    const endpoint_request_handler = (req, res) => {
        endpoint_utils.set_noobaa_server_header(res);
        endpoint_utils.prepare_rest_request(req);
        req.virtual_hosts = virtual_hosts;
        if (logger) req.bucket_logger = logger;
        if (notification_logger) req.notification_logger = notification_logger;
        init_request_sdk(req, res);
        if (req.url.startsWith('/2015-03-31/functions')) {
            return lambda_rest_handler(req, res);
        } else if (req.headers['x-ms-version']) {
            return blob_rest_handler(req, res);
        } else if (req.url.startsWith('/total_fork_count')) {
            return fork_count_handler(req, res);
        } else if (req.url.startsWith('/endpoint_fork_id')) {
            return endpoint_fork_id_handler(req, res);
        } else {
            return s3_rest.handler(req, res);
        }
    };
    /** @type {EndpointHandler} */
    const endpoint_sts_request_handler = (req, res) => {
        endpoint_utils.set_noobaa_server_header(res);
        endpoint_utils.prepare_rest_request(req);
        init_request_sdk(req, res);
        return sts_rest(req, res);
    };

    return sts ? endpoint_sts_request_handler : endpoint_request_handler;
}

function create_endpoint_handler_iam(init_request_sdk) {
    /** @type {EndpointHandler} */
    const endpoint_iam_request_handler = (req, res) => {
        endpoint_utils.set_noobaa_server_header(res);
        endpoint_utils.prepare_rest_request(req);
        init_request_sdk(req, res);
        return iam_rest(req, res);
    };
    return endpoint_iam_request_handler;
}

function endpoint_fork_id_handler(req, res) {
    let reply = {};
    if (cluster.isWorker) {
        reply = {
            worker_id: cluster.worker.id,
        };
    }
    P.delay(500);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Length', Buffer.byteLength(JSON.stringify(reply)));
    res.end(JSON.stringify(reply));
}

function fork_count_handler(req, res) {
    const reply = {
        fork_count: fork_count,
    };
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Length', Buffer.byteLength(JSON.stringify(reply)));
    res.end(JSON.stringify(reply));
}

/**
 * @param {typeof server_rpc.rpc} rpc 
 * @param {nb.APIClient} internal_rpc_client 
 * @param {ObjectIO} object_io 
 * @returns {EndpointHandler}
 */
function create_init_request_sdk(rpc, internal_rpc_client, object_io) {
    const init_request_sdk = (req, res) => {
        const rpc_client = rpc.new_client();
        req.func_sdk = new FuncSDK(rpc_client);
        req.sts_sdk = new StsSDK(rpc_client, internal_rpc_client);
        req.object_sdk = new ObjectSDK({
            rpc_client,
            internal_rpc_client,
            object_io,
            stats: endpoint_stats_collector.instance(),
        });
    };
    return init_request_sdk;
}

function get_rpc_router(env) {
    const hostname = 'localhost';
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
        syslog: env.SYSLOG_ADDR || "udp://localhost:514",
    };
}

async function get_auth_token(env) {
    if (config.NOOBAA_AUTH_TOKEN) return config.NOOBAA_AUTH_TOKEN;

    if (config.JWT_SECRET && env.LOCAL_MD_SERVER === 'true') {
        const system_store_inst = system_store.get_instance();
        await P.wait_until(() =>
            system_store_inst.is_finished_initial_load
        );
        const system = system_store_inst.data.systems[0];
        return auth_server.make_auth_token({
            system_id: system._id,
            account_id: system.owner._id,
            role: 'admin'
        });
    }

    throw new Error('NooBaa auth token is unavailable');
}


/**
 * @param {nb.APIClient} internal_rpc_client
 * @param {string} endpoint_group_id
 */
async function start_monitor(internal_rpc_client, endpoint_group_id) {
    let start_time = process.hrtime.bigint() / 1000n;
    let base_cpu_time = process.cpuUsage();

    dbg.log0('Endpoint monitor started');
    for (;;) {
        try {
            await P.delay_unblocking(config.ENDPOINT_MONITOR_INTERVAL);
            const end_time = process.hrtime.bigint() / 1000n;
            const cpu_time = process.cpuUsage();
            const elap_cpu_time = (cpu_time.system + cpu_time.user) - (base_cpu_time.system + base_cpu_time.user);
            const cpu_usage = elap_cpu_time / Number((end_time - start_time));
            const rest_usage = s3_rest.consume_usage_report();
            const group_name = endpoint_group_id;
            const hostname = os.hostname();

            dbg.log0('Sending endpoint report:', { group_name, hostname });
            const report = {
                timestamp: Date.now(),
                group_name,
                hostname,
                cpu: {
                    // using the upper limit here which includes optional burst resources
                    count: config.CONTAINER_CPU_LIMIT,
                    usage: cpu_usage
                },
                memory: {
                    // using the upper limit here which includes optional burst resources
                    total: config.CONTAINER_MEM_LIMIT,
                    used: process.memoryUsage().rss,
                },
                s3_ops: {
                    usage: rest_usage.s3_usage_info,
                    errors: rest_usage.s3_errors_info
                },
                bandwidth: [
                    ...rest_usage.bandwidth_usage_info.values()
                ]
            };

            if (internal_rpc_client) {
                await internal_rpc_client.object.add_endpoint_report(report);
            } else {
                console.log(util.inspect(report, { depth: 10, colors: true }));
            }

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
    return new Promise((resolve, reject) => {
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

    server.keepAliveTimeout = config.ENDPOINT_HTTP_SERVER_KEEPALIVE_TIMEOUT;
    server.requestTimeout = config.ENDPOINT_HTTP_SERVER_REQUEST_TIMEOUT;
    server.maxRequestsPerSocket = config.ENDPOINT_HTTP_MAX_REQUESTS_PER_SOCKET;

    server.on('error', handle_server_error);

    // This was an attempt to read from the socket in large chunks,
    // but it seems like it has no effect and we still get small chunks
    // server.on('connection', function on_s3_connection(socket) {
    // socket._readableState.highWaterMark = 1024 * 1024;
    // socket.setNoDelay(true);
    // });
}

exports.main = main;
exports.create_endpoint_handler = create_endpoint_handler;
exports.create_endpoint_handler_iam = create_endpoint_handler_iam;
exports.create_init_request_sdk = create_init_request_sdk;

if (require.main === module) main();
