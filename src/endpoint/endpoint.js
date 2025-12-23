/* Copyright (C) 2016 NooBaa */
'use strict';

// load .env file before any other modules so that it will contain
// all the arguments even when the modules are loading.
require('../util/dotenv').load();
require('../util/panic');
require('../util/fips');
const pkg = require('../../package.json');

const dbg = require('../util/debug_module')(__filename);
if (!dbg.get_process_name()) dbg.set_process_name('Endpoint');

const util = require('util');
const os = require('os');

const P = require('../util/promise');
const config = require('../../config');
const s3_rest = require('./s3/s3_rest');
const blob_rest = require('./blob/blob_rest');
const sts_rest = require('./sts/sts_rest');
const iam_rest = require('./iam/iam_rest');
const vector_rest = require('./vector/vector_rest');
const endpoint_utils = require('./endpoint_utils');
const StsSDK = require('../sdk/sts_sdk');
const ObjectIO = require('../sdk/object_io');
const ObjectSDK = require('../sdk/object_sdk');
const NBAccountSDK = require('../sdk/nb_account_sdk');
const xml_utils = require('../util/xml_utils');
const http_utils = require('../util/http_utils');
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
const { get_notification_logger } = require('../util/notifications_util');
const ldap_client = require('../util/ldap_client');
const { is_nc_environment } = require('../nc/nc_utils');
const NoobaaEvent = require('../manage_nsfs/manage_nsfs_events_utils').NoobaaEvent;

const cluster = /** @type {import('node:cluster').Cluster} */ (
    /** @type {unknown} */
    (require('node:cluster'))
);

if (process.env.NOOBAA_LOG_LEVEL) {
    const dbg_conf = debug_config.get_debug_config(process.env.NOOBAA_LOG_LEVEL);
    dbg_conf.endpoint.map(module => dbg.set_module_level(dbg_conf.level, module));
}

const SERVICES_TYPES_ENUM = Object.freeze({
    S3: 'S3',
    STS: 'STS',
    IAM: 'IAM',
    VECTOR: 'VECTOR',
    METRICS: 'METRICS',
    FORK_HEALTH: 'FORK_HEALTH',
});

const new_umask = process.env.NOOBAA_ENDPOINT_UMASK || 0o000;
const old_umask = process.umask(new_umask);
let fork_count;
dbg.log0('endpoint: replacing old umask: ', old_umask.toString(8), 'with new umask: ', new_umask.toString(8));

/**
 * @typedef {import('http').IncomingMessage & {
 *  object_sdk?: ObjectSDK;
 *  sts_sdk?: StsSDK;
 *  virtual_hosts?: readonly string[];
 *  bucket_logger?: PersistentLogger;
 *  notification_logger?: PersistentLogger;
 * }} EndpointRequest
 */

/**
 * @typedef {(
 *  req: EndpointRequest,
 *  res: import('http').ServerResponse
 * ) => void | Promise<void>} EndpointHandler
 */

/**
 * @typedef {{
 *  http_port?: number;
 *  https_port?: number;
 *  https_port_sts?: number;
 *  https_port_iam?: number;
 *  https_port_vector?: number;
 *  http_metrics_port?: number;
 *  https_metrics_port?: number;
 *  nsfs_config_root?: string;
 *  init_request_sdk?: EndpointHandler;
 *  forks?: number;
 * }} EndpointOptions
 */


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
        const http_port_s3 = options.http_port || config.ENDPOINT_PORT;
        const forks_base_port = config.ENDPOINT_FORK_PORT_BASE || (http_port_s3 + 1);
        const http_metrics_port = options.http_metrics_port || config.EP_METRICS_SERVER_PORT;
        const https_metrics_port = options.https_metrics_port || config.EP_METRICS_SERVER_SSL_PORT;
        /**
         * Please notice that we can run the main in 2 states:
         * 1. Only the primary process runs the main (fork is 0 or undefined) - everything that
         *    is implemented here would be run by this process.
         * 2. A primary process with multiple forks (IMPORTANT) - if there is implementation that
         *    in only relevant to the primary process it should be implemented in
         *    fork_utils.start_workers because the primary process returns after start_workers
         *    and the forks will continue executing the code lines in this function
         *  */
        const is_workers_started_from_primary = await fork_utils.start_workers(http_metrics_port, https_metrics_port,
            forks_base_port, options.nsfs_config_root, fork_count);
        if (is_workers_started_from_primary) return;

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

        notification_logger = config.NOTIFICATION_LOG_DIR && get_notification_logger(
            'SHARED', //shared locking for endpoitns
            undefined, //use default namespace based on hostname
            config.NSFS_GLACIER_LOGS_POLL_INTERVAL);

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

        // START S3, STS & IAM SERVERS & CERTS
        const https_port_s3 = options.https_port || config.ENDPOINT_SSL_PORT;
        const https_port_sts = options.https_port_sts || config.ENDPOINT_SSL_STS_PORT;
        const https_port_iam = options.https_port_iam || config.ENDPOINT_SSL_IAM_PORT;
        const https_port_vector = options.https_port_vector || config.ENDPOINT_SSL_VECTOR_PORT;

        await start_endpoint_server_and_cert(SERVICES_TYPES_ENUM.S3, init_request_sdk, {
            ...options,
            https_port: https_port_s3,
            http_port: http_port_s3,
            virtual_hosts,
            bucket_logger,
            notification_logger
        });
        await start_endpoint_server_and_cert(SERVICES_TYPES_ENUM.STS, init_request_sdk, { https_port: https_port_sts, virtual_hosts });
        await start_endpoint_server_and_cert(SERVICES_TYPES_ENUM.IAM, init_request_sdk, { https_port: https_port_iam });
         await start_endpoint_server_and_cert(SERVICES_TYPES_ENUM.VECTOR, init_request_sdk, { https_port: https_port_vector });
        const is_nc = is_nc_environment();
        // fork health server currently runs only on non containerized enviorment
        if (is_nc) {
            // current process is the primary and only fork. start the fork server directly with the base port
            if (cluster.isPrimary) {
                await fork_message_request_handler({
                    nsfs_config_root: options.nsfs_config_root,
                    health_port: forks_base_port
                });
                // current process is a worker so we listen to get the port from the primary process.
            } else {
                process.on('message', fork_message_request_handler);
                //send a message to the primary process that we are ready to receive messages
                process.send({ ready_to_start_fork_server: true });
            }
        }

        // START METRICS SERVER
        if ((http_metrics_port > 0 || https_metrics_port > 0) && cluster.isPrimary) {
            await prom_reporting.start_server(http_metrics_port, https_metrics_port, false, options.nsfs_config_root);
        }

        // TODO: currently NC NSFS deployments don't have internal_rpc_client nor db,
        // there for namespace monitor won't be registered
        if (internal_rpc_client && config.NAMESPACE_MONITOR_ENABLED) {
            endpoint_stats_collector.instance().set_rpc_client(internal_rpc_client);
            // Register a bg monitor on the endpoint
            background_scheduler.register_bg_worker(new NamespaceMonitor({
                name: 'namespace_fs_monitor',
                client: internal_rpc_client,
                should_monitor: nsr => Boolean(nsr.nsfs_config && process.env['NSFS_NSR_' + nsr.name]),
            }));
        }

        if (config.ENABLE_SEMAPHORE_MONITOR) {
            background_scheduler.register_bg_worker(new SemaphoreMonitor({
                name: 'semaphore_monitor',
                object_io: object_io,
            }));
        }

        if (await ldap_client.is_ldap_configured()) {
            ldap_client.instance().connect();
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
 * start_endpoint_server_and_cert starts the server by type and options and creates a certificate if required
 * @param {('S3'|'IAM'|'STS'|'VECTOR')} server_type
 * @param {EndpointHandler} init_request_sdk
 * @param {{ http_port?: number, https_port?: number, virtual_hosts?: readonly string[],
 * bucket_logger?: PersistentLogger, notification_logger?: PersistentLogger,
 * nsfs_config_root?: string}} options
 */
async function start_endpoint_server_and_cert(server_type, init_request_sdk, options = {}) {
    const { http_port, https_port, nsfs_config_root } = options;
    const endpoint_request_handler = create_endpoint_handler(server_type, init_request_sdk, options);

    if (server_type === SERVICES_TYPES_ENUM.S3) {
        if (nsfs_config_root && !config.ALLOW_HTTP) {
            dbg.warn('HTTP is not allowed for NC NSFS.');
        } else {
            await http_utils.start_http_server(http_port, server_type, endpoint_request_handler);
        }
    }
    if (https_port > 0) {
        await http_utils.start_https_server(https_port, server_type, endpoint_request_handler, nsfs_config_root);
    }
}

/**
 * @param {('S3'|'IAM'|'STS'|'VECTOR')} server_type
 * @param {EndpointHandler} init_request_sdk
 * @param {{virtual_hosts?: readonly string[], bucket_logger?: PersistentLogger, notification_logger?: PersistentLogger}} options
 * @returns {EndpointHandler}
 */
function create_endpoint_handler(server_type, init_request_sdk, { virtual_hosts, bucket_logger, notification_logger }) {
    if (server_type === SERVICES_TYPES_ENUM.S3) {
        const blob_rest_handler = process.env.ENDPOINT_BLOB_ENABLED === 'true' ? blob_rest : unavailable_handler;

        /** @type {EndpointHandler} */
        const s3_endpoint_request_handler = (req, res) => {
            endpoint_utils.set_noobaa_server_header(res);
            endpoint_utils.prepare_rest_request(req);
            req.virtual_hosts = virtual_hosts;
            if (bucket_logger) req.bucket_logger = bucket_logger;
            if (notification_logger) req.notification_logger = notification_logger;
            init_request_sdk(req, res);
            if (req.headers['x-ms-version']) {
                return blob_rest_handler(req, res);
            } else if (req.url.startsWith('/total_fork_count')) {
                return fork_count_handler(req, res);
            } else if (req.url.startsWith('/_/')) {
                // internals non S3 requests
                const api = req.url.slice('/_/'.length);
                if (api === 'version') {
                    return version_handler(req, res);
                } else {
                    return internal_api_error(req, res, `Unknown API call ${api}`);
                }
            } else {
                return s3_rest.handler(req, res);
            }
        };
        return s3_endpoint_request_handler;
    }

    if (server_type === SERVICES_TYPES_ENUM.STS) {
        /** @type {EndpointHandler} */
        const sts_endpoint_request_handler = (req, res) => {
            endpoint_utils.set_noobaa_server_header(res);
            endpoint_utils.prepare_rest_request(req);
            // req.virtual_hosts = virtual_hosts;
            init_request_sdk(req, res);
            return sts_rest(req, res);
        };
        return sts_endpoint_request_handler;
    }

    if (server_type === SERVICES_TYPES_ENUM.IAM) {
        /** @type {EndpointHandler} */
        const iam_endpoint_request_handler = (req, res) => {
            endpoint_utils.set_noobaa_server_header(res);
            endpoint_utils.prepare_rest_request(req);
            init_request_sdk(req, res);
            return iam_rest(req, res);
        };
        return iam_endpoint_request_handler;
    }


    if (server_type === SERVICES_TYPES_ENUM.VECTOR) {
        /** @type {EndpointHandler} */
        const vector_endpoint_request_handler = (req, res) => {
            endpoint_utils.set_noobaa_server_header(res);
            endpoint_utils.prepare_rest_request(req);
            init_request_sdk(req, res);
            return vector_rest(req, res);
        };
        return vector_endpoint_request_handler;
    }
}

///////////////////////////
// INTERNAL API HANDLERS //
///////////////////////////

/**
 * version_handler returns the version of noobaa package
 * @param {EndpointRequest} req
 * @param {import('http').ServerResponse} res
 */
function version_handler(req, res) {
    if (config.NOOBAA_VERSION_AUTH_ENABLED && !http_utils.authorize_bearer(req, res)) return;
    const noobaa_package_version = pkg.version;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Length', Buffer.byteLength(noobaa_package_version));
    res.end(noobaa_package_version);
}

/**
 * internal_api_error returns an internal api error response
 * @param {EndpointRequest} req
 * @param {import('http').ServerResponse} res
 * @param {string} error_message
 */
function internal_api_error(req, res, error_message) {
    const buffer = Buffer.from(JSON.stringify({ error: 'Internal Server Error', message: error_message }));
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
}

/**
 * endpoint_fork_id_handler returns the worker id of the current fork
 * @param {EndpointRequest} req
 * @param {import('http').ServerResponse} res
 */
function endpoint_fork_id_handler(req, res) {
    let reply = {};
    if (cluster.isWorker) {
        reply = { worker_id: cluster.worker.id };
    }
    P.delay(500);
    res.statusCode = 200;
    const buffer = Buffer.from(JSON.stringify(reply));
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
}

/**
 * fork_count_handler returns the total number of forks
 * @param {EndpointRequest} req
 * @param {import('http').ServerResponse} res
 */
function fork_count_handler(req, res) {
    const reply = { fork_count: fork_count };
    res.statusCode = 200;
    const buffer = Buffer.from(JSON.stringify(reply));
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
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
        req.sts_sdk = new StsSDK(rpc_client, internal_rpc_client);
        req.object_sdk = new ObjectSDK({
            rpc_client,
            internal_rpc_client,
            object_io,
            stats: endpoint_stats_collector.instance(),
        });
        req.account_sdk = new NBAccountSDK({
            rpc_client,
            internal_rpc_client,
            //stats: endpoint_stats_collector.instance(),
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

/**
 * handler for the inidivdual fork server. used to handle requests the get the worker id
 * currently used to check if fork is alive by the health script
 * @param {EndpointRequest} req
 * @param {import('http').ServerResponse} res
 */
function fork_main_handler(req, res) {
    endpoint_utils.set_noobaa_server_header(res);
    endpoint_utils.prepare_rest_request(req);
    if (req.url.startsWith('/endpoint_fork_id')) {
        return endpoint_fork_id_handler(req, res);
    } else {
        return internal_api_error(req, res, `Unknown API call ${req.url}`);
    }
}

/**
 * fork_message_request_handler is used to handle messages from the primary process.
 * the primary process sends a message with the designated port to start the fork server.
 * @param {Object} msg
 */
async function fork_message_request_handler(msg) {
    await http_utils.start_https_server(msg.health_port,
        SERVICES_TYPES_ENUM.FORK_HEALTH,
        fork_main_handler,
        msg.nsfs_config_root
    );
}

exports.main = main;
exports.create_endpoint_handler = create_endpoint_handler;
exports.create_init_request_sdk = create_init_request_sdk;
exports.endpoint_fork_id_handler = endpoint_fork_id_handler;

if (require.main === module) main();
