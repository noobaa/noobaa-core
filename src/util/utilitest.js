// make jshint ignore mocha globals
/* global before, after */
'use strict';

var _ = require('lodash');
var P = require('../util/promise');
var http = require('http');
var express = require('express');
var express_body_parser = require('body-parser');
var express_cookie_parser = require('cookie-parser');
var express_cookie_session = require('cookie-session');
var express_method_override = require('method-override');
var mongoose = require('mongoose');
var mongoose_logger = require('./mongoose_logger');
var dbg = require('./debug_module')(__filename);

mongoose.set('debug', mongoose_logger(dbg.log0.bind(dbg)));

// we create a single express app and server to make the test faster,
// but there's a caveat - setting up routes on the same app has the issue
// that there is no way to remove/replace middlewares in express, and adding
// just adds to the end of the queue.
var app = express();
var COOKIE_SECRET = 'utilitest cookie secret';
app.use(express_cookie_parser(COOKIE_SECRET));
// must install a body parser for restful server to work
app.use(express_body_parser.json());
app.use(express_body_parser.raw());
app.use(express_body_parser.text());
app.use(express_body_parser.urlencoded({
    extended: false
}));
app.use(express_method_override());
app.use(express_cookie_session({
    key: 'utilitest_session',
    secret: COOKIE_SECRET,
    maxage: 356 * 24 * 60 * 60 * 1000 // 1 year
}));
var router = new express.Router();
app.use(router);

var http_server = http.createServer(app);

// initlizations before the tests
before(function(done) {
    P.fcall(function() {
        var defer = P.defer();
        mongoose.connection.once('open', defer.resolve);
        mongoose.connection.on('error', console.error.bind(console, 'mongoose connection error:'));
        mongoose.connect('mongodb://localhost/utilitest');
        return defer.promise;
    }).then(function() {
        // dropDatabase to clear the previous test
        return P.npost(mongoose.connection.db, 'dropDatabase');
    }).then(function() {
        // after dropDatabase() we need to recreate the indexes
        // otherwise we get "MongoError: ns doesn't exist"
        // see https://github.com/LearnBoost/mongoose/issues/2671
        return P.all(_.map(mongoose.modelNames(), function(model_name) {
            return P.npost(mongoose.model(model_name), 'ensureIndexes');
        }));
    }).then(function() {
        return P.npost(http_server, 'listen');
    }).then(function() {
        console.log('* utilitest server listening on port ', http_server.address().port);
        console.log();
    }, function(err) {
        console.error('utilitest ERROR', err);
        throw err;
    }).nodeify(done);
});

after(function() {
    mongoose.disconnect();
    http_server.close();
});

module.exports = {
    http_server: http_server,
    http_port: function() {
        return http_server.address().port;
    },
    router: router,
    app: app,
};
