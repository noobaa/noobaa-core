'use strict';

process.on('uncaughtException', function(err) {
    console.log(err.stack);
});

// important - dot settings should run before any require() that might use dot
// or else the it will get mess up (like the email.js code)
var dot_engine = require('noobaa-util/dot_engine');
var _ = require('lodash');
var Q = require('q');
var fs = require('fs');
var path = require('path');
var URL = require('url');
var http = require('http');
var mongoose = require('mongoose');
var dotenv = require('dotenv');
var express = require('express');
var express_favicon = require('static-favicon');
var express_morgan_logger = require('morgan');
var express_body_parser = require('body-parser');
var express_cookie_parser = require('cookie-parser');
var express_cookie_session = require('cookie-session');
var express_method_override = require('method-override');
var express_compress = require('compression');


if (!process.env.PORT) {
    console.log('loading .env file ( no foreman ;)');
    dotenv.load();
}

var rootdir = path.join(__dirname, '..', '..');
var dev_mode = (process.env.DEV_MODE === 'true');
var debug_mode = (process.env.DEBUG_MODE === 'true');


// connect to the database
mongoose.connect(process.env.MONGOHQ_URL);
mongoose.set('debug', debug_mode);

// create express app
var app = express();
var web_port = process.env.PORT || 5001;
app.set('port', web_port);

// setup view template engine with doT
var views_path = path.join(rootdir, 'src', 'views');
app.set('views', views_path);
app.engine('html', dot_engine(views_path));


////////////////
// MIDDLEWARE //
////////////////

// configure app middleware handlers in the order to use them

app.use(express_favicon(path.join(rootdir, 'images', 'noobaa_icon_bgblack.ico')));
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
        return res.redirect('https://' + host + req.url);
    }
    return next();
});
app.use(express_cookie_parser(process.env.COOKIE_SECRET));
app.use(express_body_parser.json());
app.use(express_body_parser.raw());
app.use(express_body_parser.text());
app.use(express_body_parser.urlencoded({
    extended: false
}));
app.use(express_method_override());
app.use(express_cookie_session({
    key: 'noobaa_session',
    secret: process.env.COOKIE_SECRET,
    // TODO: setting max-age for all sessions although we prefer only for /auth.html
    // but express/connect seems broken to accept individual session maxAge,
    // although documented to work. people also report it fails.
    maxage: 356 * 24 * 60 * 60 * 1000 // 1 year
}));
app.use(express_compress());


////////////
// ROUTES //
////////////
// using router before static files is optimized
// since we have less routes then files, and the routes are in memory.

// setup apis

var api_router = express.Router();
var account_server = require('./account_server');
var system_server = require('./system_server');
var edge_node_server = require('./edge_node_server');
var object_server = require('./object_server');
account_server.install_routes(api_router);
system_server.install_routes(api_router);
edge_node_server.install_routes(api_router);
object_server.install_routes(api_router);
app.use('/api', api_router);


// setup pages

function redirect_no_account(req, res, next) {
    if (req.session.account && req.session.account.id) {
        return next();
    }
    return res.redirect('/login/');
}

function page_context(req) {
    var data = {};
    _.extend(data, _.pick(req.session, 'account'));
    return {
        data: data
    };
}

app.all('/agent/*', redirect_no_account, function(req, res) {
    return res.render('agent.html', page_context(req));
});
app.all('/agent', redirect_no_account, function(req, res) {
    return res.redirect('/agent/');
});

app.all('/app/*', redirect_no_account, function(req, res) {
    return res.render('app.html', page_context(req));
});
app.all('/app', redirect_no_account, function(req, res) {
    return res.redirect('/app/');
});

app.all('/login/*', function(req, res) {
    return res.render('login.html', page_context(req));
});
app.all('/login', function(req, res) {
    return res.redirect('/login/');
});

app.all('/logout', function(req, res) {
    var logout_func = system_server.impl('logout_account');
    Q.when(logout_func(req), function() {
        res.redirect('/login/');
    });
});

app.all('/', redirect_no_account, function(req, res) {
    return res.redirect('/app/');
});



////////////
// STATIC //
////////////

function cache_control(seconds) {
    var millis = 1000 * seconds;
    return function(req, res, next) {
        res.setHeader("Cache-Control", "public, max-age=" + seconds);
        res.setHeader("Expires", new Date(Date.now() + millis).toUTCString());
        return next();
    };
}

// setup static files
app.use('/public/', cache_control(dev_mode ? 0 : 10 * 60)); // 10 minutes
app.use('/public/', express.static(path.join(rootdir, 'build', 'public')));
app.use('/public/images/', cache_control(dev_mode ? 3600 : 24 * 3600)); // 24 hours
app.use('/public/images/', express.static(path.join(rootdir, 'images')));
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
        e = _.pick(err, 'status', 'message', 'reload');
    }
    e.status = err.status || res.statusCode;
    if (e.status < 400) {
        e.status = 500;
    }
    res.status(e.status);

    if (can_accept_html(req)) {
        var ctx = { //common_api.common_server_data(req);
            data: {}
        };
        if (dev_mode) {
            e.data = _.extend(ctx.data, e.data);
        } else {
            e.data = ctx.data;
        }
        return res.render('error.html', e);
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

function error_403(req, res, next) {
    console.log('NO USER', req.originalMethod, req.originalUrl);
    if (can_accept_html(req)) {
        return res.redirect(URL.format({
            pathname: '/login/',
            query: {
                state: req.originalUrl
            }
        }));
    }
    var err = {
        status: 403, // forbidden
        message: 'NO USER',
        reload: true
    };
    return next(err);
}

function error_501(req, res, next) {
    return next({
        status: 501, // not implemented
        message: 'Working on it... ' + req.originalUrl
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



// start http server
var server = http.createServer(app);
server.listen(web_port, function() {
    console.log('Web server on port ' + web_port);
});
