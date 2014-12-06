/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var fs = require('fs');
var os = require('os');
var http = require('http');
var path = require('path');
var util = require('util');
var repl = require('repl');
var assert = require('assert');
var crypto = require('crypto');
var mkdirp = require('mkdirp');
var mime = require('mime');
var argv = require('minimist')(process.argv);
var BlockStream = require('block-stream');
var Semaphore = require('noobaa-util/semaphore');
var size_utils = require('../util/size_utils');
var api = require('../api');
var client_streamer = require('./client_streamer');
var dbg = require('../util/dbg')(module);

Q.longStackSupport = true;


/**
 *
 * ClientCLI
 *
 */
function ClientCLI(params) {
    var self = this;
    self.params = _.defaults(params, {
        address: params.prod ? 'https://noobaa-core.herokuapp.com' : 'http://localhost:5001',
        streamer: params.prod ? 5005 : 5006,
        email: 'a@a.a',
        password: 'aaa',
        system: 'sys',
        tier: 'edge',
        bucket: 'bucket',
    });
    self.client = new api.Client();
    self.client.options.set_address(self.params.address);
}


/**
 *
 * INIT
 *
 *
 *
 */
ClientCLI.prototype.init = function() {
    var self = this;

    if (self.params.setup) {
        return self.client.setup(self.params)
            .then(function() {
                console.log('COMPLETED: setup', self.params);
            }, function(err) {
                console.log('ERROR: setup', self.params, err);
            })
            .then(function() {
                process.exit();
            });
    }

    return self.load()
        .then(function() {
            console.log('COMPLETED: load');
        }, function(err) {
            console.log('ERROR: load', self.params, err);

        });
};



/**
 *
 * LOAD
 *
 */
ClientCLI.prototype.load = function() {
    var self = this;

    return Q.fcall(function() {
            var auth_params = _.pick(self.params,
                'email', 'password', 'system', 'role');
            if (self.params.bucket) {
                auth_params.extra = {
                    bucket: self.params.bucket
                };
            }
            console.log('create auth', auth_params);
            return self.client.create_auth_token(auth_params);
        })
        .then(function() {
            return client_streamer(self.client, self.params.streamer);
        })
        .then(function(streamer) {
            self.streamer = streamer;
        });
};



/**
 *
 * UPLOAD
 *
 * create new node agent
 *
 */
ClientCLI.prototype.upload = function(file_path) {
    var self = this;
    var key = file_path + '-' + Date.now();
    var stats;

    return Q.fcall(function() {
            return Q.nfcall(fs.stat, file_path);
        })
        .then(function(stats_arg) {
            stats = stats_arg;
            return self.client.object.create_multipart_upload({
                bucket: self.params.bucket,
                key: key,
                size: stats.size,
                content_type: mime.lookup(file_path),
            });
        })
        .then(function() {
            var total_write_size = 3 * stats.size;
            var pos = 0;
            var client_events = self.client.object.events();
            client_events.removeAllListeners('send');
            client_events.on('send', function(len) {
                if (!len) return;
                pos += len;
                dbg.log_progress(pos / total_write_size);
            });
            return Q.Promise(function(resolve, reject) {
                fs.createReadStream(file_path)
                    .pipe(new BlockStream(512 * size_utils.KILOBYTE, {
                        nopad: true
                    }))
                    .pipe(self.client.object.open_write_stream({
                        bucket: self.params.bucket,
                        key: key,
                    }).once('error', function(err) {
                        reject(err);
                    }).once('finish', function() {
                        resolve();
                    }));
            });
        })
        .then(function() {
            return self.client.object.complete_multipart_upload({
                bucket: self.params.bucket,
                key: key,
            });
        })
        .then(function() {
            console.log('COMPLETED: upload', file_path);
        }, function(err) {
            console.log('ERROR: upload', file_path, err);
        });
};



/**
 *
 * DOWNLOAD
 *
 * download object by key and save to local file
 *
 */
ClientCLI.prototype.download = function(key) {
    var self = this;

    return Q.fcall(function() {
            // ...
        })
        .then(function() {
            // ...
        })
        .then(function() {
            console.log('COMPLETED: download');
        }, function(err) {
            console.log('ERROR: download', err);
        });
};



/**
 *
 * DELETE
 *
 * delete object by key
 *
 */
ClientCLI.prototype.delete = function(key) {
    var self = this;

    return Q.fcall(function() {
            // ...
        })
        .then(function() {
            // ...
        })
        .then(function() {
            console.log('COMPLETED: delete');
        }, function(err) {
            console.log('ERROR: delete', err);
        });
};


/**
 *
 * LIST
 *
 * list objects in bucket
 *
 */
ClientCLI.prototype.list = function(key) {
    var self = this;

    return Q.fcall(function() {
            return self.client.object.list_objects({
                bucket: self.params.bucket
            });
        })
        .then(function(res) {
            console.log('objects in bucket', self.params.bucket, ':');
            var i = 1;
            _.each(res.objects, function(obj) {
                console.log('#' + i, obj.key, '\t', obj.info.size, 'bytes');
                i++;
            });
        })
        .then(function() {
            console.log('COMPLETED: list');
        }, function(err) {
            console.log('ERROR: list', err);
        });
};



/**
 *
 * WRITE_BLOCK
 *
 */
ClientCLI.prototype.write_block = function(ip, port, file_name) {
    var self = this;

    return Q
        .nfcall(fs.readFile, file_name)
        .then(function(buffer) {
            var agent = new api.agent_api.Client();
            agent.options.set_address('http://' + ip + ':' + port);

            var block_id = 'TEST-' + path.basename(file_name);
            console.log('write_block', buffer.length, block_id, agent);

            return agent.write_block({
                block_id: block_id,
                data: buffer,
            });
        })
        .then(function() {
            console.log('COMPLETED: write_block');
        }, function(err) {
            console.log('ERROR: write_block', err);
        });
};


/**
 *
 * READ_BLOCK
 *
 */
ClientCLI.prototype.read_block = function(ip, port, file_name) {
    var self = this;

    return Q
        .fcall(function() {
            var agent = new api.agent_api.Client();
            agent.options.set_address('http://' + ip + ':' + port);

            var block_id = 'TEST-' + path.basename(file_name);
            console.log('read_block', block_id, agent);

            return agent.read_block({
                block_id: block_id,
            });
        })
        .then(function(buffer) {
            var out = buffer.slice(0, 1024 * 1024);
            console.log(out.toString());
        })
        .then(function() {
            console.log('COMPLETED: read_block');
        }, function(err) {
            console.log('ERROR: read_block', err);
        });
};



function main() {
    var cli = new ClientCLI(argv);
    cli.init().done(function() {
        // start a Read-Eval-Print-Loop
        var repl_srv = repl.start({
            prompt: 'client-cli > ',
            useGlobal: false,
        });
        var help = {
            functions: [],
            variables: [],
        };
        _.forIn(cli, function(val, key) {
            if (typeof(val) === 'function') {
                repl_srv.context[key] = val.bind(cli);
                help.functions.push(key);
            } else {
                repl_srv.context[key] = val;
                help.variables.push(key);
            }
        });
        repl_srv.context.dbg = dbg;
        repl_srv.context.help = help;
    });
}

if (require.main === module) {
    main();
}
