'use strict';
var fs = require('fs');
var https = require('https');
var http = require('http');

var params = {
    address: 'http://localhost:5001',
    streamer: 5006,
    email: 'demo@noobaa.com',
    password: 'DeMo',
    system: 'demo',
    tier: 'devices',
    bucket: 'files',
};
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

    // app.use(function(req, res, next) {
    //
    //     req.pipe(concat(function(data) {
    //         req.body = data;
    //         next();
    //     }));
    // });

    app.use(function (req, res, next) {
      console.log('Time:', Date.now(),req.headers,req.query,req.query.prefix,req.query.delimiter);
      if (req.headers.host)
      {
          if (req.headers.host.indexOf(params.bucket)===0)
          {
              req.url = req.url.replace('/','/'+params.bucket+'/');
              console.log('update path with bucket name',req.url,req.path,params.bucket);
          }
          if (req.query.prefix && req.query.delimiter){
              if (req.query.prefix.indexOf(req.query.delimiter)<0)
              {
                  req.url = req.url.replace(req.query.prefix,req.query.prefix+req.query.delimiter);
                  console.log('updated prefix',req.url,req.query.prefix);
                  req.query.prefix = req.query.prefix+req.query.delimiter;

              }
          }
          if (req.url.indexOf('/'+params.bucket+'?')>=0){
              //req.url = req.url.replace(params.bucket,params.bucket+'/');
              console.log('updated bucket name with delimiter',req.url);
          }


      }
      next();
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
            var privateKey = fs.readFileSync('/Users/eran/workspace/key.pem');
            var certificate = fs.readFileSync('/Users/eran/workspace/cert.pem');
            http.createServer(app.handle.bind(app)).listen(80);
            https.createServer({
                key: privateKey,
                cert: certificate
            }, app.handle.bind(app)).listen(port, hostname, function(err) {
                return done(err, hostname, port, directory);
            }).on('error', function(err) {
                return done(err);
            });
        }
    };
};

module.exports = app;
