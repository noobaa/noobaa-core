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
var Semaphore = require('noobaa-util/semaphore');
var size_utils = require('../util/size_utils');
var range_utils = require('../util/range_utils');
var api = require('../api');
var client_streamer = require('./client_streamer');
var dbg = require('noobaa-util/debug_module')(__filename);

Q.longStackSupport = true;


/**
 *
 * ClientCLI
 *
 */
function ClientCLI(params) {
    var self = this;
    self.params = params;
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

    return Q.nfcall(fs.readFile, 'agent_conf.json')
        .then(function(data) {
            var agent_conf = JSON.parse(data);
            dbg.log0('using agent_conf.json', util.inspect(agent_conf));
            self.params = _.defaults(self.params, agent_conf);
        }).then(null, function(err) {
            dbg.log0('cannot find configuration file. Using defaults.');
            self.params = _.defaults(self.params, {
                address: 'http://localhost:5001',
                streamer: params.prod ? 5005 : 5006,
                email: 'demo@noobaa.com',
                password: 'DeMo',
                system: 'demo',
                tier: 'nodes',
                bucket: 'files'
            });
        })
        .then(function() {
            self.client = new api.Client();
            self.client.options.set_address(self.params.address);

            if (self.params.setup) {
                var account_params = _.pick(self.params, 'email', 'password');
                account_params.name = account_params.email;
                return self.client.account.create_account(account_params)
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
                    console.log('ERROR: load', self.params, err.stack);
                    process.exit();
                }).then(function() {
                    if (argv.upload) {
                        // not returning the promise on purpose - to allow the repl to start
                        self.upload(argv.upload);
                    }
                });
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
            dbg.log1('create auth', auth_params);
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
    var key = path.basename(file_path) + '_' + Date.now();

    return Q.fcall(function() {
            return Q.nfcall(fs.stat, file_path);
        })
        .then(function(stats) {
            return self.client.object.upload_stream({
                bucket: self.params.bucket,
                key: key,
                size: stats.size,
                content_type: mime.lookup(file_path),
                source_stream: fs.createReadStream(file_path),
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
 * DEL
 *
 * delete object by key
 *
 */
ClientCLI.prototype.del = function(key) {
    var self = this;

    return Q.fcall(function() {
            return self.client.object.delete_object({
                bucket: self.params.bucket,
                key: key
            });
        })
        .then(function() {
            console.log('COMPLETED: del');
        }, function(err) {
            console.log('ERROR: del', err);
        });
};


/**
 *
 * SYS
 *
 * show system info
 *
 */
ClientCLI.prototype.sys = function() {
    var self = this;

    return Q.fcall(function() {
            return self.client.system.read_system();
        })
        .then(function(res) {
            console.log('\n\n-----------------------------');
            console.log('System info :', res.name);
            console.log('-----------------------------');

            console.log('\nUsers:');
            _.each(res.roles, function(role) {
                console.log('\tRole  :', role.role);
                console.log('\tEmail :', role.account.name);
            });

            console.log('\nStorage:');
            console.log('\tAllocated  :', size_utils.human_size(res.storage.alloc));
            console.log('\tData size  :', size_utils.human_size(res.storage.used));
            console.log('\tDisk usage :', size_utils.human_size(res.storage.real));

            console.log('\nNodes:');
            console.log('\tTotal  :', res.nodes.count);
            console.log('\tOnline :', res.nodes.online);

            console.log('\nTiers:');
            _.each(res.tiers, function(tier) {
                console.log('\tName         :', tier.name);
                console.log('\tNodes total  :', tier.nodes.count);
                console.log('\tNodes online :', tier.nodes.online);
                console.log('\tAllocated    :', size_utils.human_size(tier.storage.alloc));
                console.log('\tData size    :', size_utils.human_size(tier.storage.used));
            });

            console.log('\nBuckets:');
            _.each(res.buckets, function(bkt) {
                console.log('\tName      :', bkt.name);
                console.log('\tObjects   :', bkt.num_objects);
                console.log('\tQuota     :', size_utils.human_size(bkt.storage.alloc));
                console.log('\tData size :', size_utils.human_size(bkt.storage.used));
            });

        })
        .then(function() {
            console.log('\nCOMPLETED: sys');
        }, function(err) {
            console.log('ERROR: sys', err);
        });
};


/**
 *
 * LIST
 *
 * list objects in bucket
 *
 */
ClientCLI.prototype.list_objects = function(key) {
    var self = this;

    return Q.fcall(function() {
            return self.client.object.list_objects({
                bucket: self.params.bucket
            });
        })
        .then(function(res) {
            console.log('objects in bucket', self.params.bucket, ':');
            var i = 0;
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
 * LIST_NODES
 *
 * list objects in bucket
 *
 */
ClientCLI.prototype.list_nodes = function() {
    var self = this;

    return Q.fcall(function() {
            return self.client.node.list_nodes({});
        })
        .then(function(res) {
            var i = 1;
            _.each(res.nodes, function(node) {
                console.log('#' + i, node.name, node.ip + ':' + node.port,
                    'online:', node.online, 'heartbeat:', node.heartbeat,
                    'storage.used:', size_utils.human_size(node.storage.used));
                i++;
            });
        })
        .then(function() {
            console.log('COMPLETED: list_nodes');
        }, function(err) {
            console.log('ERROR: list_nodes', err);
        });
};




/**
 *
 * OBJECT_MAPS
 *
 */
ClientCLI.prototype.object_maps = function(key) {
    var self = this;

    return self.client.object.read_object_mappings({
            bucket: self.params.bucket,
            key: key,
        })
        .then(function(mappings) {
            console.log('\n\nListing object maps:', key);
            console.log('-------------------\n');
            var i = 1;
            _.each(mappings.parts, function(part) {
                var nodes_list = _.flatten(_.map(part.fragments, function(fragment) {
                    return _.map(fragment.blocks, function(block) {
                        return block.address.host.slice(7); // slice 'http://' prefix
                    });
                })).join(',\t');
                console.log('#' + i, '[' + part.start + '..' + part.end + ']:\t', nodes_list);
                i += 1;
            });
        })
        .then(function() {
            console.log('COMPLETED: object_maps');
        }, function(err) {
            console.log('ERROR: object_maps', err);
        });
};


/**
 *
 * NODE_MAPS
 *
 */
ClientCLI.prototype.node_maps = function(node_name) {
    var self = this;

    return Q.fcall(function() {
            return self.client.node.read_node_maps({
                name: node_name
            });
        })
        .then(function(res) {
            var node_host = 'http://' + res.node.ip + ':' + res.node.port;
            console.log('\n\nListing object blocks for node:', node_name);
            console.log('------------------------------');
            _.each(res.objects, function(object) {
                console.log('\nObject:', object.key);
                var i = 1;
                _.each(object.parts, function(part) {
                    _.each(part.fragments, function(fragment_blocks, fragment) {
                        var nodes_list = _.map(fragment_blocks, function(block) {
                            if (block.address.host === node_host) {
                                return '*' + block.address.host.slice(7);
                            } else {
                                return block.address.host.slice(7);
                            }
                        }).sort().join(',\t');
                        console.log('#' + i, '[' + part.start + '..' + part.end + ']:\t', nodes_list);
                        i += 1;
                    });
                });
            });
        })
        .then(function() {
            console.log('COMPLETED: node_maps');
        }, function(err) {
            console.log('ERROR: node_maps', err);
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


process.stdin.resume();//so the program will not close instantly

function exitHandler() {
    console.log('exiting');
    process.exit();
}

process.on('exit', function(code) {
    console.log('About to exit with code:', code);
});

process.on('uncaughtException', function(err) {
    console.log('Caught exception: ' + err + ' ; ' + err.stack);
    //exitHandler();
});
