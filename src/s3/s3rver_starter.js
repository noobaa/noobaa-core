'use strict';
require('../util/panic');

var _ = require('lodash');
var Q = require('q');
var fs = require('fs');
var util = require('util');
var S3rver = require('./s3rver');
var dbg = require('noobaa-util/debug_module')(__filename);
var argv = require('minimist')(process.argv);

var params = argv;

Q.nfcall(fs.readFile, 'agent_conf.json')
    .then(function(data) {
        var agent_conf = JSON.parse(data);
        dbg.log0('using agent_conf.json', util.inspect(agent_conf));
        params = _.defaults(params, agent_conf);
        return;
    }).then(null, function(err) {
        dbg.log0('cannot find configuration file. Using defaults.' + err);
        params = _.defaults(params, {
            address: 'http://localhost:5001',
            port: 80,
            ssl_port: 443,
        });
        return;
    }).then(function() {
        var s3rver = new S3rver(params);
        return Q.fcall(s3rver.run.bind(s3rver))
            .then(null, function(err) {
                dbg.log0('FAILED TO START S3 SERVER', err, err.stack);
            });

    });
