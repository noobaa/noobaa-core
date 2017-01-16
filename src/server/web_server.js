/* Copyright (C) 2016 NooBaa */
'use strict';

// load .env file before any other modules so that it will contain
// all the arguments even when the modules are loading.
console.log('loading .env file');
require('../util/dotenv').load();

//If test mode, use Istanbul for coverage
for (let i = 0; i < process.argv.length; ++i) {
    if (process.argv[i] === '--TESTRUN') {
        process.env.TESTRUN = 'true'; // must be string
    }
}
if (process.env.TESTRUN === 'true') {
    // eslint-disable-next-line global-require
    var ist = require('../test/framework/istanbul_coverage');
    ist.start_istanbul_coverage();
}

require('../util/panic');

// dump heap with kill -USR2 <pid>
require('heapdump');

const _ = require('lodash');
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const http = require('http');
const https = require('https');
const multer = require('multer');
const express = require('express');
const express_favicon = require('serve-favicon');
const express_compress = require('compression');
const express_body_parser = require('body-parser');
const express_morgan_logger = require('morgan');
const express_method_override = require('method-override');
const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const pem = require('../util/pem');
const pkg = require('../../package.json');
const config = require('../../config.js');
const mongo_client = require('../util/mongo_client');
const mongoose_utils = require('../util/mongoose_utils');
const system_store = require('./system_services/system_store').get_instance();
const SupervisorCtl = require('./utils/supervisor_ctrl');
const account_server = require('./system_services/account_server');
const system_server = require('./system_services/system_server');

const rootdir = path.join(__dirname, '..', '..');
const dev_mode = (process.env.DEV_MODE === 'true');
const app = express();

system_store.once('load', account_server.ensure_support_account);

dbg.set_process_name('WebServer');
mongoose_utils.mongoose_connect();
mongo_client.instance().connect();


/////////
// RPC //
/////////

var server_rpc = require('./server_rpc');
server_rpc.register_system_services();
server_rpc.register_node_services();
server_rpc.register_object_services();
server_rpc.register_func_services();
server_rpc.register_common_services();
server_rpc.rpc.register_http_transport(app);
server_rpc.rpc.router.default = 'fcall://fcall';

var http_port = process.env.PORT = process.env.PORT || 5001;
var https_port = process.env.SSL_PORT = process.env.SSL_PORT || 5443;
var http_server = http.createServer(app);
var https_server;

// TODO: chang this. a temp fix to block /version until upgrade is finished
// this is not cleared if upgrade fails, and will block UI until browser refresh.
// maybe we need to change it to use upgrade status in DB.
let shutting_down = false;
let webserver_started = 0;

P.fcall(function() {
        // we register the rpc before listening on the port
        // in order for the rpc services to be ready immediately
        // with the http services like /fe and /version
        server_rpc.rpc.register_ws_transport(http_server);
        return P.ninvoke(http_server, 'listen', http_port);
    })
    .then(function() {
        if (fs.existsSync(path.join('/etc', 'private_ssl_path', 'server.key')) &&
            fs.existsSync(path.join('/etc', 'private_ssl_path', 'server.crt'))) {
            dbg.log0('Using local certificate');
            var local_certificate = {
                serviceKey: fs.readFileSync(path.join('/etc', 'private_ssl_path', 'server.key')),
                certificate: fs.readFileSync(path.join('/etc', 'private_ssl_path', 'server.crt'))
            };
            return local_certificate;
        } else {
            dbg.log0('Using self-signed certificate', path.join('/etc', 'private_ssl_path', 'server.key'));
            return P.fromCallback(callback => pem.createCertificate({
                days: 365 * 100,
                selfSigned: true
            }, callback));
        }
    })
    .then(function(cert) {
        https_server = https.createServer({
            key: cert.serviceKey,
            cert: cert.certificate
        }, app);
        server_rpc.rpc.register_ws_transport(https_server);
        return P.ninvoke(https_server, 'listen', https_port);
    })
    .then(function() {
        dbg.log('Web Server Started, ports: http', http_port, 'https', https_port);
        webserver_started = Date.now();
    })
    .catch(function(err) {
        dbg.error('Web Server FAILED TO START', err.stack || err);
        process.exit(1);
    });


////////////////
// MIDDLEWARE //
////////////////

// copied from s3rver. not sure why. but copy.
app.disable('x-powered-by');

// configure app middleware handlers in the order to use them

app.use(express_favicon(path.join(rootdir, 'frontend/dist/assets', 'noobaa_icon.ico')));
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
    let current_clustering = system_store.get_local_cluster_info();
    if ((current_clustering && current_clustering.is_clusterized) &&
        !system_store.is_cluster_master && req.originalUrl !== '/upload_package' && req.originalUrl !== '/version') {
        P.fcall(() => server_rpc.client.cluster_internal.redirect_to_cluster_master())
            .then(host => {
                res.status(307);
                return res.redirect(`http://${host}:8080` + req.originalUrl);
            })
            .catch(err => {
                res.status(500);
            });
    } else {
        return next();
    }
});
app.use(express_method_override());
app.use(express_body_parser.json());
app.use(express_body_parser.raw());
app.use(express_body_parser.text());
app.use(express_body_parser.urlencoded({
    extended: false
}));
app.use(express_compress());


////////////
// ROUTES //
////////////

// setup pages

app.post('/upgrade',
    multer({
        storage: multer.diskStorage({
            destination: function(req, file, cb) {
                cb(null, '/tmp');
            },
            filename: function(req, file, cb) {
                dbg.log0('UPGRADE upload', file);
                cb(null, 'nb_upgrade_' + Date.now() + '_' + file.originalname.replace(/ /g, ''));
            }
        })
    })
    .single('upgrade_file'),
    function(req, res) {
        var upgrade_file = req.file;
        dbg.log0('got upgrade file:', upgrade_file);
        dbg.log0('calling cluster.upgrade_cluster()');
        shutting_down = true;
        server_rpc.client.cluster_internal.upgrade_cluster({
            filepath: upgrade_file.path
        });
        res.end('<html><head><meta http-equiv="refresh" content="60;url=/console/" /></head>Upgrading. You will be redirected back to the upgraded site in 60 seconds.');
    });

app.post('/upload_certificate',
    multer({
        storage: multer.diskStorage({
            destination: function(req, file, cb) {
                cb(null, '/tmp');
            },
            filename: function(req, file, cb) {
                dbg.log0('uploading SSL Certificate', file);
                cb(null, 'nb_ssl_certificate_' + Date.now() + '_' + file.originalname);
            }
        })
    })
    .single('upload_file'), (req, res) => system_server.set_certificate(req.file)
    .then(() => {
        res.status(200).send('SUCCESS');
        if (os.type() === 'Linux') {
            dbg.log0('Restarting server on certificate set');
            return SupervisorCtl.restart(['s3rver', 'webserver']);
        }
    })
    .catch(err => {
        dbg.error('Was unable to set certificate', err);
        res.status(500).send('Was unable to set certificate');
    })
);

app.post('/upload_package',
    multer({
        storage: multer.diskStorage({
            destination: function(req, file, cb) {
                cb(null, '/tmp');
            },
            filename: function(req, file, cb) {
                dbg.log0('UPGRADE upload', file);
                cb(null, 'nb_upgrade_' + Date.now() + '_' + file.originalname);
            }
        })
    })
    .single('upgrade_file'),
    function(req, res) {
        var upgrade_file = req.file;
        server_rpc.client.cluster_internal.member_pre_upgrade({
            filepath: upgrade_file.path,
            mongo_upgrade: false
        }); //Async
        res.end('<html><head></head>Upgrade file uploaded successfully');
    });

//Upgrade from 0.3.X will try to return to this path. We will redirect it.
app.get('/console', function(req, res) {
    return res.redirect('/fe/');
});

app.get('/', function(req, res) {
    return res.redirect('/fe/');
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
    dbg.set_level(req.param('level'), req.param('module'));

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

// Get the current version
app.get('/version', function(req, res) {
    const registered = server_rpc.is_service_registered('system_api.read_system');
    let current_clustering = system_store.get_local_cluster_info();
    let started;
    if (current_clustering && !current_clustering.is_clusterized) {
        // if not clusterized then no need to wait.
        started = true;
    } else {
        // if in a cluster then after upgrade the user should be redirected to the new master
        // give the new master 10 seconds to start completely before ending the upgrade
        const WEBSERVER_START_TIME = 10 * 1000;
        started = webserver_started && (Date.now() - webserver_started) > WEBSERVER_START_TIME;
    }
    if (started && registered && !shutting_down) {
        dbg.log0(`/version returning ${pkg.version}, service registered and not shutting down`);
        res.send(pkg.version);
        res.end();
    } else {
        dbg.log0(`/version returning 404, service_registered ${registered}, shutting_down ${shutting_down}`);
        res.status(404).end();
    }
});

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

// setup static files

//use versioned executables
var setup_filename = 'noobaa-setup-' + pkg.version;
var s3_rest_setup_filename = 'noobaa-s3rest-' + pkg.version;
app.use('/public/noobaa-setup.exe', express.static(path.join(rootdir, 'build', 'public', setup_filename + '.exe')));
app.use('/public/noobaa-setup', express.static(path.join(rootdir, 'build', 'public', setup_filename)));
app.use('/public/noobaa-s3rest.exe', express.static(path.join(rootdir, 'build', 'public', s3_rest_setup_filename + 'exe')));

app.use('/public/', cache_control(dev_mode ? 0 : 10 * 60)); // 10 minutes
app.use('/public/', express.static(path.join(rootdir, 'build', 'public')));
app.use('/public/images/', cache_control(dev_mode ? 3600 : 24 * 3600)); // 24 hours
app.use('/public/images/', express.static(path.join(rootdir, 'images')));
app.use('/public/eula', express.static(path.join(rootdir, 'EULA.pdf')));

// Serve the new frontend (management console)
app.use('/fe/assets', express.static(path.join(rootdir, 'frontend', 'dist', 'assets')));
app.use('/fe', express.static(path.join(rootdir, 'frontend', 'dist')));
app.get('/fe/**/', function(req, res) {
    var filePath = path.join(rootdir, 'frontend', 'dist', 'index.html');
    res.sendFile(filePath);
});

app.use('/', express.static(path.join(rootdir, 'public')));



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
    e.statusCode = err.statusCode || res.statusCode;
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
        message: 'We dug the earth, but couldn\'t find ' + req.originalUrl
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
