'use strict';
var fs = require('fs');
var https = require('https');
var http = require('http');
var dbg = require('noobaa-util/debug_module')(__filename);

var app = function(params) {


    var express = require('express'),
        app = express(),
        //logger = require('./logger')(false),
        Controllers = require('./controllers'),
        controllers = new Controllers(params),
        concat = require('concat-stream');



    // app.use(function(req, res, next) {
    //
    //     req.pipe(concat(function(data) {
    //         req.body = data;
    //         next();
    //     }));
    // });

    app.use(function (req, res, next) {
        dbg.log0('Time:', Date.now(),req.headers,req.query,req.query.prefix,req.query.delimiter);
      if (req.headers.host)
      {
          if (req.headers.host.indexOf(params.bucket)===0)
          {
              req.url = req.url.replace('/','/'+params.bucket+'/');
              dbg.log0('update path with bucket name',req.url,req.path,params.bucket);
          }
          if (req.query.prefix && req.query.delimiter){
              if (req.query.prefix.indexOf(req.query.delimiter)<0)
              {
                  req.url = req.url.replace(req.query.prefix,req.query.prefix+req.query.delimiter);
                  dbg.log0('updated prefix',req.url,req.query.prefix);
                  req.query.prefix = req.query.prefix+req.query.delimiter;

              }
          }
          if (req.url.indexOf('/'+params.bucket+'?')>=0){
              //req.url = req.url.replace(params.bucket,params.bucket+'/');
              dbg.log0('updated bucket name with delimiter',req.url);
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
            http.createServer(app.handle.bind(app)).listen(params.port);
            https.createServer({
                key: privateKey,
                cert: certificate
            }, app.handle.bind(app)).listen(params.ssl_port, params.hostname, function(err) {
                return done(err, params.hostname, params.port);
            }).on('error', function(err) {
                return done(err);
            });
        }
    };


};

module.exports = app;
