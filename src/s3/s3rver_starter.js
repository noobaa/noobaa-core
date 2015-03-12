'use strict';
var a=1;
var fs = require('fs');
var S3rver = require('./s3rver');
var util = require('util');
var Q = require('q');
var _ = require('lodash');
var dbg = require('noobaa-util/debug_module')(__filename);


var params = {};
Q.nfcall(fs.readFile, 'agent_conf.json')
    .then(function(data) {
        var agent_conf = JSON.parse(data);
        dbg.log0('using agent_conf.json', util.inspect(agent_conf));
        params = _.defaults(params, agent_conf);
        return;
    }).then(null, function(err) {
        dbg.log0('cannot find configuration file. Using defaults.'+err);
        params = _.defaults(params, {
            address: 'http://localhost:5001',
            email: 'demo@noobaa.com',
            password: 'DeMo',
            system: 'demo',
            tier: 'nodes',
            bucket: 'files',
            port: 80,
            ssl_port: 443,
            ssl_hostname: '127.0.0.1'

        });
        return;
    }).then(function(){
    var s3rver = new S3rver(params);

    return Q.nfcall(function(){
        s3rver
        .run(function(err, host, port) {
            dbg.log0('S3 is listening on host %s and port %d', host, port);
        });
    }).then(null,function(err){
        dbg.log0('err',err,err.stack);
    });

});
