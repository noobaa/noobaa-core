/* Copyright (C) 2016 NooBaa */
'use strict';

// load .env file before any other modules so that it will contain
// all the arguments even when the modules are loading.
console.log('loading .env file');
const dotenv = require('../util/dotenv');
dotenv.load();

require('../util/coverage_utils');
require('../util/panic');
require('../util/fips');

const dbg = require('../util/debug_module')(__filename);
dbg.set_process_name('WebServer');
const debug_config = require('../util/debug_config');

const _ = require('lodash');
const path = require('path');
const util = require('util');
const http = require('http');
const https = require('https');
const express = require('express');
const express_compress = require('compression');
const express_morgan_logger = require('morgan');
const express_proxy = require('express-http-proxy');
const P = require('../util/promise');
const ssl_utils = require('../util/ssl_utils');
const pkg = require('../../package.json');
const config = require('../../config.js');
const license_info = require('./license_info');
const db_client = require('../util/db_client');
const system_store = require('./system_services/system_store').get_instance();
const prom_reporting = require('./analytic_services/prometheus_reporting');
const account_server = require('./system_services/account_server');
const stats_aggregator = require('./system_services/stats_aggregator');
const addr_utils = require('../util/addr_utils');
const kube_utils = require('../util/kube_utils');
const http_utils = require('../util/http_utils');

const rootdir = path.join(__dirname, '..', '..');
const dev_mode = (process.env.DEV_MODE === 'true');
const app = express();

if (process.env.NOOBAA_LOG_LEVEL) {
    let dbg_conf = debug_config.get_debug_config(process.env.NOOBAA_LOG_LEVEL);
    dbg_conf.core.map(module => dbg.set_module_level(dbg_conf.level, module));
}

db_client.instance().connect();

//Set KeepAlive to all http/https agents in webserver
http_utils.update_http_agents({ keepAlive: true });
http_utils.update_https_agents({ keepAlive: true });

const server_rpc = require('./server_rpc');
server_rpc.register_system_services();
server_rpc.register_node_services();
server_rpc.register_object_services();
server_rpc.register_func_services();
server_rpc.register_common_services();
server_rpc.rpc.register_http_app(app);
server_rpc.rpc.router.default = 'fcall://fcall';

const http_port = process.env.PORT || 5001;
const https_port = process.env.SSL_PORT || 5443;
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

async function start_web_server() {
    try {
        // we register the rpc before listening on the port
        // in order for the rpc services to be ready immediately
        // with the http services like /version
        var http_server = http.createServer(app);
        server_rpc.rpc.register_ws_transport(http_server);
        await P.ninvoke(http_server, 'listen', http_port);

        const ssl_cert = await ssl_utils.get_ssl_certificate('MGMT');
        const https_server = https.createServer({ ...ssl_cert, honorCipherOrder: true }, app);
        server_rpc.rpc.register_ws_transport(https_server);
        await P.ninvoke(https_server, 'listen', https_port);

    } catch (err) {
        dbg.error('Web Server FAILED TO START', err.stack || err);
        process.exit(1);
    }

    // Try to start the metrics server.
    await prom_reporting.start_server(config.WS_METRICS_SERVER_PORT);
}

////////////////
// MIDDLEWARE //
////////////////

// copied from s3rver. not sure why. but copy.
app.disable('x-powered-by');

// configure app middleware handlers in the order to use them

app.use(express_morgan_logger(dev_mode ? 'dev' : 'combined'));
app.use(function(req, res, next) {
    // HTTPS redirect:
    // since we want to provide secure and certified connections
    // for the entire application, so once a request for http arrives,
    // we redirect it to https.
    // it was suggested to use the req.secure flag to check that.
    // however our nodejs server is always http so the flag is false,
    // and on heroku only the router does ssl,
    // so we need to pull the heroku router headers to check.
    var fwd_proto = req.get('X-Forwarded-Proto');
    // var fwd_port = req.get('X-Forwarded-Port');
    // var fwd_from = req.get('X-Forwarded-For');
    // var fwd_start = req.get('X-Request-Start');
    if (fwd_proto === 'http') {
        var host = req.get('Host');
        return res.redirect('https://' + host + req.originalUrl);
    }
    return next();
});
app.use(function(req, res, next) {
    return next();
});
app.use(express_compress());


////////////
// ROUTES //
////////////
if (config.PROMETHEUS_ENABLED) {
    // Enable proxying for all metrics servers
    app.use('/metrics/web_server', express_proxy(`localhost:${config.WS_METRICS_SERVER_PORT}`));
    app.use('/metrics/bg_workers', express_proxy(`localhost:${config.BG_METRICS_SERVER_PORT}`));
    app.use('/metrics/hosted_agents', express_proxy(`localhost:${config.HA_METRICS_SERVER_PORT}`));
}

app.get('/', function(req, res) {
    return res.redirect(`/version`);
});

// Upgrade checks
app.get('/get_latest_version*', function(req, res) {
    if (req.params[0].indexOf('&curr=') !== -1) {
        try {
            var query_version = req.params[0].substr(req.params[0].indexOf('&curr=') + 6);
            var ret_version = '';

            if (!is_latest_version(query_version)) {
                ret_version = config.on_premise.base_url + process.env.CURRENT_VERSION + '/' + config.on_premise.nva_part;
            }

            res.status(200).send({
                version: ret_version,
            });
        } catch (err) {
            // nop
        }
    }
    res.status(400).send({});
});

//Log level setter
app.post('/set_log_level*', function(req, res) {
    console.log('req.module', req.param('module'), 'req.level', req.param('level'));
    if (typeof req.param('module') === 'undefined' || typeof req.param('level') === 'undefined') {
        res.status(400).end();
    }

    dbg.log0('Change log level requested for', req.param('module'), 'to', req.param('level'));
    dbg.set_module_level(req.param('level'), req.param('module'));

    return server_rpc.client.redirector.publish_to_cluster({
            target: '', // required but irrelevant
            method_api: 'debug_api',
            method_name: 'set_debug_level',
            request_params: {
                level: req.param('level'),
                module: req.param('module')
            }
        })
        .then(function() {
            res.status(200).end();
        });
});

//Log level getter
app.get('/get_log_level', function(req, res) {
    var all_modules = util.inspect(dbg.get_module_structure(), true, 20);

    res.status(200).send({
        all_levels: all_modules,
    });
});

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
app.get('/oauth/authorize', async (req, res) => {
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
    authorization_endpoint.searchParams.set('redirect_uri', redirect_uri);
    authorization_endpoint.searchParams.set('state', decodeURIComponent(return_url));

    res.redirect(authorization_endpoint);
});


// Get the current version
app.get('/version', (req, res) => getVersion(req.url)
    .then(({ status, version }) => {
        if (version) res.send(version);
        if (status !== 200) res.status(status);
        res.end();
    })
);


// Get the NSFS stats
app.get('/metrics/nsfs_stats', async (req, res) => {
    const report = _create_nsfs_report();
    res.send(report);
    res.status(200).end();
});

function _create_nsfs_report() {
    let nsfs_report = '';

    const nsfs_counters = stats_aggregator.get_nsfs_io_stats();
    // Building the report per io and value
    for (const [key, value] of Object.entries(nsfs_counters)) {
        const metric = `NooBaa_nsfs_${key}`.toLowerCase();
        nsfs_report += `${metric}: ${value}<br>`;
    }

    const op_stats = stats_aggregator.get_op_stats();
    // Building the report per op name key and value
    for (const [op_name, obj] of Object.entries(op_stats)) {
        nsfs_report += `<br>`;
        for (const [key, value] of Object.entries(obj)) {
            const metric = `NooBaa_nsfs_${op_name}_${key}`.toLowerCase();
            nsfs_report += `${metric}: ${value}<br>`;
        }
    }

    const fs_workers_stats = stats_aggregator.get_fs_workers_stats();
    // Building the report per fs worker name key and value
    for (const [fs_worker_name, obj] of Object.entries(fs_workers_stats)) {
        nsfs_report += `<br>`;
        for (const [key, value] of Object.entries(obj)) {
            const metric = `NooBaa_nsfs_${fs_worker_name}_${key}`.toLowerCase();
            nsfs_report += `${metric}: ${value}<br>`;
        }
    }

    dbg.log1(`_create_nsfs_report: nsfs_report ${nsfs_report}`);

    return nsfs_report;
}

////////////
// STATIC //
////////////

// using router before static files to optimize -
// since we usually have less routes then files, and the routes are in memory.

function cache_control(seconds) {
    var millis = 1000 * seconds;
    return function(req, res, next) {
        res.setHeader("Cache-Control", "public, max-age=" + seconds);
        res.setHeader("Expires", new Date(Date.now() + millis).toUTCString());
        return next();
    };
}

app.use('/public/', cache_control(dev_mode ? 0 : 10 * 60)); // 10 minutes
app.use('/public/', express.static(path.join(rootdir, 'build', 'public')));
app.use('/public/images/', cache_control(dev_mode ? 3600 : 24 * 3600)); // 24 hours
app.use('/public/images/', express.static(path.join(rootdir, 'images')));
app.use('/public/eula', express.static(path.join(rootdir, 'EULA.pdf')));
app.use('/public/license-info', license_info.serve_http);
app.use('/public/audit.csv', express.static(path.join('/log', 'audit.csv')));

// Serve the new frontend (management console)
// app.use('/', express.static(path.join(rootdir, 'public')));

// error handlers should be last
// roughly based on express.errorHandler from connect's errorHandler.js
app.use(error_404);
app.use(function(err, req, res, next) {
    console.error('ERROR:', err);
    var e;
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
        var ctx = { //common_api.common_server_data(req);
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
});

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

// Check if given version is the latest version, or are there newer ones
// Version is in the form of X.Y.Z, start checking from left to right
function is_latest_version(query_version) {
    var srv_version = process.env.CURRENT_VERSION;
    console.log('Checking version', query_version, 'against', srv_version);

    if (query_version === srv_version) {
        return true;
    }

    var srv_version_parts = srv_version.toString().split('.');
    var query_version_parts = query_version.split('.');

    var len = Math.min(srv_version_parts.length, query_version_parts.length);

    // Compare common parts
    for (let i = 0; i < len; i++) {
        //current part of server is greater, query version is outdated
        if (parseInt(srv_version_parts[i], 10) > parseInt(query_version_parts[i], 10)) {
            return false;
        }

        if (parseInt(srv_version_parts[i], 10) < parseInt(query_version_parts[i], 10)) {
            console.error('BUG?! Queried version (', query_version, ') is higher than server version(',
                srv_version, ') ! How can this happen?');
            return true;
        }
    }

    // All common parts are equal, check if there are tailing version parts
    if (srv_version_parts.length > query_version_parts.length) {
        return false;
    }

    if (srv_version_parts.length < query_version_parts.length) {
        console.error('BUG?! Queried version (', query_version, ') is higher than server version(',
            srv_version, '), has more tailing parts! How can this happen?');
        return true;
    }

    return true;
}


if (require.main === module) start_web_server();
