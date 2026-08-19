/* Copyright (C) 2016 NooBaa */
'use strict';

// load .env file before any other modules so that it will contain
// all the arguments even when the modules are loading.
require('../util/dotenv').load();
require('../util/panic');
require('../util/fips');

const dbg = require('../util/debug_module')(__filename);
if (!dbg.get_process_name()) dbg.set_process_name('WebServer');
const debug_config = require('../util/debug_config');

const _ = require('lodash');
const http = require('http');
const https = require('https');
const express = require('express');
const express_compress = require('compression');
const http_request_logger = require('../util/http_request_logger');
const express_proxy = require('express-http-proxy');
const P = require('../util/promise');
const ssl_utils = require('../util/ssl_utils');
const pkg = require('../../package.json');
const config = require('../../config.js');
const db_client = require('../util/db_client');
const system_store = require('./system_services/system_store').get_instance();
const prom_reporting = require('./analytic_services/prometheus_reporting');
const account_server = require('./system_services/account_server');
const stats_aggregator = require('./system_services/stats_aggregator');
const addr_utils = require('../util/addr_utils');
const kube_utils = require('../util/kube_utils');
const http_utils = require('../util/http_utils');
const server_rpc = require('./server_rpc');
const node_server = require('./node_services/node_server');

const dev_mode = (process.env.DEV_MODE === 'true');
const http_port = process.env.PORT || '5001';
const https_port = process.env.SSL_PORT || '5443';

async function main() {
    try {

        if (process.env.NOOBAA_LOG_LEVEL) {
            const dbg_conf = debug_config.get_debug_config(process.env.NOOBAA_LOG_LEVEL);
            dbg_conf.core.map(module => dbg.set_module_level(dbg_conf.level, module));
        }


        //Set KeepAlive to all http/https agents in webserver
        http_utils.update_http_agents({ keepAlive: true });
        http_utils.update_https_agents({ keepAlive: true });

        // register the rpc route first, and then the rest of the web server routes
        const app = express();
        server_rpc.register_system_services();
        server_rpc.register_node_services();
        server_rpc.register_object_services();
        server_rpc.register_common_services();
        server_rpc.rpc.router.default = 'fcall://fcall';
        server_rpc.rpc.register_http_app(app);
        setup_web_server_app(app);

        process.env.PORT = http_port;
        process.env.SSL_PORT = https_port;

        system_store.once('load', async () => {
            await account_server.ensure_support_account();
            if (process.env.CREATE_SYS_NAME && process.env.CREATE_SYS_EMAIL &&
                system_store.data.systems.length === 0) {
                dbg.log0(`creating system for kubernetes: ${process.env.CREATE_SYS_NAME}. email: ${process.env.CREATE_SYS_EMAIL}`);
                await server_rpc.client.system.create_system({
                    name: process.env.CREATE_SYS_NAME,
                    email: process.env.CREATE_SYS_EMAIL,
                    password: process.env.CREATE_SYS_PASSWD || 'DeMo1',
                    must_change_password: true
                });
            }
        });

        await db_client.instance().connect();

        // we register the rpc before listening on the port
        // in order for the rpc services to be ready immediately
        // with the http services like /version
        const http_server = http.createServer(app);
        server_rpc.rpc.register_ws_transport(http_server);
        await P.ninvoke(http_server, 'listen', http_port);

        const ssl_cert_info = await ssl_utils.get_ssl_cert_info('MGMT');
        const ssl_options = { ...ssl_cert_info.cert, honorCipherOrder: true };
        ssl_utils.apply_tls_config(ssl_options, 'MGMT');
        const https_server = https.createServer(ssl_options, app);
        ssl_cert_info.on('update', updated_cert_info => {
            dbg.log0("Setting updated MGMT ssl certs for web server.");
            const updated_ssl_options = { ...updated_cert_info.cert, honorCipherOrder: true };
            ssl_utils.apply_tls_config(updated_ssl_options, 'MGMT');
            https_server.setSecureContext(updated_ssl_options);
        });
        server_rpc.rpc.register_ws_transport(https_server);
        await P.ninvoke(https_server, 'listen', https_port);

        // Try to start the metrics server.
        await prom_reporting.start_server(config.WS_METRICS_SERVER_PORT);

        dbg.log0('WebServer waiting for SystemStore load...');
        await system_store.wait_for_load();
        dbg.log0('WebServer SystemStore loaded, starting node monitor');
        await node_server.start_monitor();

    } catch (err) {
        dbg.error('Web Server FAILED TO START', err.stack || err);
        process.exit(1);
    }
}

function setup_web_server_app(app) {

    // copied from s3rver. not sure why. but copy.
    app.disable('x-powered-by');
    app.use(http_request_logger(dev_mode ? 'dev' : 'combined'));
    app.use(https_redirect_handler);
    app.use(express_compress());

    app.get('/version', get_version_handler);

    app.get('/oauth/authorize', oauth_authorise_handler);

    app.get('/metrics/nsfs_stats', metrics_nsfs_stats_handler);
    if (config.PROMETHEUS_ENABLED) {
        // Enable proxying for all metrics servers
        app.use('/metrics/web_server', express_proxy(`localhost:${config.WS_METRICS_SERVER_PORT}`));
        app.use('/metrics/bg_workers', express_proxy(`localhost:${config.BG_METRICS_SERVER_PORT}`));
        app.use('/metrics/hosted_agents', express_proxy(`localhost:${config.HA_METRICS_SERVER_PORT}`));
    }

    app.get('/', (req, res) => res.redirect(`/version`));

    // error handlers should be last
    app.use(error_404);
    app.use(error_handler);
}

function https_redirect_handler(req, res, next) {
    // HTTPS redirect:
    // since we want to provide secure and certified connections
    // for the entire application, so once a request for http arrives,
    // we redirect it to https.
    // it was suggested to use the req.secure flag to check that.
    // however our nodejs server is always http so the flag is false,
    // and on heroku only the router does ssl,
    // so we need to pull the heroku router headers to check.
    const fwd_proto = req.get('X-Forwarded-Proto');
    // var fwd_port = req.get('X-Forwarded-Port');
    // var fwd_from = req.get('X-Forwarded-For');
    // var fwd_start = req.get('X-Request-Start');
    if (fwd_proto === 'http') {
        const host = req.get('Host');
        return res.redirect('https://' + host + req.originalUrl);
    }
    return next();
}

async function get_version_handler(req, res) {
    // Authorize bearer token version endpoint
    if (config.NOOBAA_VERSION_AUTH_ENABLED && !http_utils.authorize_bearer(req, res)) return;
    const { status, version } = await getVersion(req.url);
    if (version) res.send(version);
    if (status !== 200) res.status(status);
    res.end();
}

async function getVersion(route) {
    const registered = server_rpc.is_service_registered('system_api.read_system');
    if (registered && system_store.is_finished_initial_load) {
        return {
            status: 200,
            version: pkg.version
        };
    } else {
        dbg.log0(`${route} returning 404, service_registered(${registered}), system_store loaded(${system_store.is_finished_initial_load})`);
        return { status: 404 };
    }
}

// An oauth authorize endpoint that forwards to the OAuth authorization server.
async function oauth_authorise_handler(req, res) {
    const {
        KUBERNETES_SERVICE_HOST,
        KUBERNETES_SERVICE_PORT,
        NOOBAA_SERVICE_ACCOUNT,
        OAUTH_AUTHORIZATION_ENDPOINT
    } = process.env;

    if (!KUBERNETES_SERVICE_HOST || !KUBERNETES_SERVICE_PORT) {
        dbg.warn('/oauth/authorize: oauth is supported only on OpenShift deployments');
        res.status(500);
        res.end();
        return;
    }

    if (!OAUTH_AUTHORIZATION_ENDPOINT) {
        dbg.warn('/oauth/authorize: oauth support was not configured for this system');
        res.status(500);
        res.end();
        return;
    }

    if (!NOOBAA_SERVICE_ACCOUNT) {
        dbg.warn('/oauth/authorize: noobaa k8s service account name is not available');
        res.status(500);
        res.end();
    }

    let redirect_host;
    if (dev_mode) {
        redirect_host = `https://localhost:${https_port}`;

    } else {
        const { system_address } = system_store.data.systems[0];
        redirect_host = addr_utils.get_base_address(system_address, {
            hint: 'EXTERNAL',
            protocol: 'https'
        }).toString();
    }

    const k8s_namespace = await kube_utils.read_namespace();
    const client_id = `system:serviceaccount:${k8s_namespace}:${NOOBAA_SERVICE_ACCOUNT}`;
    const redirect_uri = new URL(config.OAUTH_REDIRECT_ENDPOINT, redirect_host);
    const return_url = new URL(req.url, 'http://dummy').searchParams.get('return-url');
    const authorization_endpoint = new URL(OAUTH_AUTHORIZATION_ENDPOINT);
    authorization_endpoint.searchParams.set('client_id', client_id);
    authorization_endpoint.searchParams.set('response_type', 'code');
    authorization_endpoint.searchParams.set('scope', config.OAUTH_REQUIRED_SCOPE);
    authorization_endpoint.searchParams.set('redirect_uri', redirect_uri.toString());
    authorization_endpoint.searchParams.set('state', decodeURIComponent(return_url));

    res.redirect(authorization_endpoint);
}

function metrics_nsfs_stats_handler(req, res) {
    let nsfs_report = '';

    const nsfs_counters = stats_aggregator.get_nsfs_io_stats();
    // Building the report per io and value
    for (const [key, value] of Object.entries(nsfs_counters)) {
        const metric = `noobaa_nsfs_io_${key}`.toLowerCase();
        nsfs_report += `${metric}: ${value}<br>`;
    }

    const op_stats = stats_aggregator.get_op_stats();
    // Building the report per op name key and value
    for (const [op_name, obj] of Object.entries(op_stats)) {
        nsfs_report += `<br>`;
        for (const [key, value] of Object.entries(obj)) {
            const metric = `noobaa_nsfs_op_${op_name}_${key}`.toLowerCase();
            nsfs_report += `${metric}: ${value}<br>`;
        }
    }

    const fs_workers_stats = stats_aggregator.get_fs_workers_stats();
    // Building the report per fs worker name key and value
    for (const [fs_worker_name, obj] of Object.entries(fs_workers_stats)) {
        nsfs_report += `<br>`;
        for (const [key, value] of Object.entries(obj)) {
            const metric = `noobaa_nsfs_fs_${fs_worker_name}_${key}`.toLowerCase();
            nsfs_report += `${metric}: ${value}<br>`;
        }
    }

    dbg.log1(`_create_nsfs_report: nsfs_report ${nsfs_report}`);

    res.send(nsfs_report);
    res.status(200).end();
}

// roughly based on express.errorHandler from connect's errorHandler.js
function error_handler(err, req, res, next) {
    console.error('ERROR:', err);
    let e;
    if (dev_mode) {
        // show internal info only on development
        e = err;
    } else {
        e = _.pick(err, 'statusCode', 'message', 'reload');
    }
    e.statusCode = err.status || res.statusCode;
    if (e.statusCode < 400) {
        e.statusCode = 500;
    }
    res.status(e.statusCode);

    if (can_accept_html(req)) {
        const ctx = { //common_api.common_server_data(req);
            data: {}
        };
        if (dev_mode) {
            e.data = _.extend(ctx.data, e.data);
        } else {
            e.data = ctx.data;
        }
        return res.end(`<html>
<head>
    <style>
        body {
            color: #242E35;
        }
    </style>
</head>
<body>
    <h1>NooBaa</h1>
    <h2>${e.message}</h2>
    <h3>(Error Code ${e.statusCode})</h3>
    <p><a href="/">Take me back ...</a></p>
</body>
</html>`);
    } else if (req.accepts('json')) {
        return res.json(e);
    } else {
        return res.type('txt').send(e.message || e.toString());
    }
}

function error_404(req, res, next) {
    return next({
        status: 404, // not found
        message: 'We dug the earth, but couldn\'t find your requested URL'
    });
}

// decide if the client can accept html reply.
// the xhr flag in the request (X-Requested-By header) is not commonly sent
// see https://github.com/angular/angular.js/commit/3a75b1124d062f64093a90b26630938558909e8d
// the accept headers from angular http contain */* so will match anything.
// so finally we fallback to check the url.

function can_accept_html(req) {
    return !req.xhr && req.accepts('html') && req.originalUrl.indexOf('/api/') !== 0;
}

exports.main = main;

if (require.main === module) main();
