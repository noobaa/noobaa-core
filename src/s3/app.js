'use strict';
var fs = require('fs');

var app = function(hostname, port, directory, silent) {
    var express = require('express'),
        app = express(),
        //logger = require('./logger')(false),
        Controllers = require('./controllers'),
        controllers = new Controllers(directory),
        concat = require('concat-stream');

    /**
     * Log all requests
     */
    app.use(require('morgan')('tiny', {
        'stream': {
            write: function(message) {
                console.error(message.slice(0, -1));
            }
        }
    }));

    // create a write stream (in append mode)
    var accessLogStream = fs.createWriteStream(directory + '/access.log', {
        flags: 'a'
    });

    // setup the logger
    app.use(require('morgan')('combined', {
        stream: accessLogStream
    }));

    app.use(function(req, res, next) {

        req.pipe(concat(function(data) {
            req.body = data;
            next();
        }));
    });

    app.disable('x-powered-by');

    /**
     * Routes for the application
     */
    app.get('/', controllers.getBuckets);
    app.get('/:bucket', controllers.bucketExists, controllers.getBucket);
    app.delete('/:bucket', controllers.bucketExists, controllers.deleteBucket);
    app.put('/:bucket', controllers.putBucket);
    app.put('/:bucket/:key(*)', controllers.bucketExists, controllers.putObject);
    app.get('/:bucket/:key(*)', controllers.bucketExists, controllers.getObject);
    app.head('/:bucket/:key(*)', controllers.getObject);
    app.delete('/:bucket/:key(*)', controllers.bucketExists, controllers.deleteObject);

    return {
        serve: function(done) {
            app.listen(port, hostname, function(err) {
                return done(err, hostname, port, directory);
            }).on('error', function(err) {
                return done(err);
            });
        }
    };
};

module.exports = app;
