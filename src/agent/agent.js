/* jshint node:true */
'use strict';

var _ = require('lodash');
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var http = require('http');
var mkdirp = require('mkdirp');
var express = require('express');
var Q = require('q');
var LRU = require('noobaa-util/lru');
var size_utils = require('../util/size_utils');
var system_api = require('../api/system_api');
var edge_node_api = require('../api/edge_node_api');
var agent_api = require('../api/agent_api');
var express_morgan_logger = require('morgan');
var express_body_parser = require('body-parser');
var express_method_override = require('method-override');
var express_compress = require('compression');
var os = require('os');

module.exports = Agent;

/**
 * The inglorious noobaa agent.
 */
function Agent(params) {
    var self = this;
    assert(params.system_client, 'missing params.system_client');
    assert(params.edge_node_client, 'missing params.edge_node_client');
    assert(params.account_credentials, 'missing params.account_credentials');
    assert(params.node_name, 'missing params.node_name');
    assert(params.node_geolocation, 'missing params.node_geolocation');
    self.system_client = params.system_client;
    self.edge_node_client = params.edge_node_client;
    self.account_credentials = params.account_credentials;
    self.node_name = params.node_name;
    self.node_geolocation = params.node_geolocation;

    self.storage_path = params.storage_path;
    var lru_options = {};
    if (self.storage_path) {
        self.storage_path_node = path.join(self.storage_path, self.node_name);
        self.storage_path_blocks = path.join(self.storage_path_node, 'blocks');
        lru_options.max_length = 10;
    } else {
        // use lru as memory storage
        lru_options.max_length = 1000000;
    }
    self.blocks_lru = new LRU(lru_options);

    var app = express();
    app.use(express_morgan_logger('dev'));
    app.use(express_body_parser.json());
    app.use(express_body_parser.raw({
        limit: 16 * size_utils.MEGABYTE // size limit on raw requests
    }));
    app.use(express_body_parser.text());
    app.use(express_body_parser.urlencoded({
        extended: false
    }));
    app.use(express_method_override());
    app.use(express_compress());
    // enable CORS for agent_api
    app.use('/agent_api/', function(req, res, next) {
        res.header('Access-Control-Allow-Methods', 'POST, GET, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type');
        res.header('Access-Control-Allow-Origin', '*');
        // note that browsers will not allow origin=* with credentials
        // but anyway we allow it by the agent server.
        res.header('Access-Control-Allow-Credentials', true);
        next();
    });
    var agent_server = new agent_api.Server({
        write_block: self.write_block.bind(self),
        read_block: self.read_block.bind(self),
        check_block: self.check_block.bind(self),
        remove_block: self.remove_block.bind(self),
    });
    agent_server.install_routes(app, '/agent_api/');

    var http_server = http.createServer(app);
    http_server.on('listening', self.server_listening_handler.bind(self));
    http_server.on('close', self.server_close_handler.bind(self));
    http_server.on('error', self.server_error_handler.bind(self));

    self.agent_app = app;
    self.agent_server = agent_server;
    self.http_server = http_server;
    self.http_port = 0;

    // TODO maintain persistent allocated_storage
    self.allocated_storage = size_utils.GIGABYTE;
    self.used_storage = 0;
    self.num_blocks = 0;
}

Agent.prototype.start = function() {
    var self = this;

    self.is_started = true;
    console.log('start agent', self.node_name);

    return Q.fcall(
        function() {
            return self.system_client.login_account(self.account_credentials);
        }
    ).then(
        function() {
            return self.mkdirs();
        }
    ).then(
        function() {
            return self.start_stop_http_server();
        }
    ).then(
        function() {
            return self.send_heartbeat();
        }
    ).then(
        function() {
            self.start_stop_heartbeats();
        }
    ).then(null,
        function(err) {
            console.error('AGENT server failed to start', err);
            self.stop();
            throw err;
        }
    );
};

Agent.prototype.stop = function() {
    var self = this;
    console.log('stop agent', self.node_name);
    self.is_started = false;
    self.start_stop_http_server();
    self.start_stop_heartbeats();
};

Agent.prototype.mkdirs = function() {
    var self = this;
    if (!self.storage_path) {
        return;
    }
    var dir_paths = [self.storage_path_blocks];
    var mkdir_funcs = _.map(dir_paths, function(dir_path) {
        return function() {
            return Q.nfcall(mkdirp, dir_path);
        };
    });
    // run all funcs serially by chaining their promises
    return _.reduce(mkdir_funcs, Q.when, Q.when());
};

/////////////////
// HTTP SERVER //
/////////////////

Agent.prototype.start_stop_http_server = function() {
    var self = this;
    if (self.is_started) {
        // using port to determine if the server is already listening
        if (!self.http_port) {
            return Q.Promise(function(resolve, reject) {
                self.http_server.once('listening', resolve);
                self.http_server.listen();
            });
        }
    } else {
        if (self.http_port) {
            self.http_server.close();
        }
    }
};

Agent.prototype.server_listening_handler = function() {
    this.http_port = this.http_server.address().port;
    console.log('AGENT server listening on port', this.http_port);
};

Agent.prototype.server_close_handler = function() {
    console.log('AGENT server closed');
    this.http_port = 0;
    // set timer to check the state and react by restarting or not
    setTimeout(this.start_stop_http_server.bind(this), 1000);
};

Agent.prototype.server_error_handler = function(err) {
    // the server will also trigger close event after
    console.error('AGENT server error', err);
};



////////////////
// HEARTBEATS //
////////////////

Agent.prototype.start_stop_heartbeats = function() {
    var self = this;
    // first clear the timer
    clearInterval(self.heartbeat_interval);
    self.heartbeat_interval = null;
    // set the timer when started
    if (self.is_started) {
        self.heartbeat_interval =
            setInterval(self.send_heartbeat.bind(self), 60000);
    }
};


Agent.prototype.send_heartbeat = function() {
    var self = this;
    console.log('send heartbeat by agent', self.node_name);
    return this.edge_node_client.heartbeat({
        name: self.node_name,
        geolocation: self.node_geolocation,
        ip: '',
        port: self.http_port,
        started: true,
        online: true,
        heartbeat: new Date().toString(),
        allocated_storage: self.allocated_storage,
        used_storage: self.used_storage,
        system_info: {
            os: {
                hostname: os.hostname(),
                type: os.type(),
                platform: os.platform(),
                arch: os.arch(),
                release: os.release(),
                uptime: os.uptime(),
                loadavg: os.loadavg(),
                totalmem: os.totalmem(),
                freemem: os.freemem(),
                cpus: os.cpus(),
                networkInterfaces: os.networkInterfaces(),
            }
        }
    });
};



///////////////
// AGENT API //
///////////////



Agent.prototype._block_path = function(block_id) {
    return !this.storage_path_blocks ? '' :
        path.join(this.storage_path_blocks, block_id);
};

Agent.prototype._read_block = function(block_id) {
    var self = this;
    var lru_block = self.blocks_lru.find_or_add_item(block_id);
    if (lru_block && lru_block.data) {
        // console.log('read block from cache', block_id,
        // lru_block.data.length, typeof(lru_block.data), self.node_name);
        return lru_block.data;
    }
    var block_path = self._block_path(block_id);
    if (!block_path) {
        throw new Error('NO BLOCK STORAGE');
    }
    return Q.nfcall(fs.readFile, block_path).then(
        function(data) {
            // console.log('read block from disk', block_id,
            // data.length, typeof(data), self.node_name);
            lru_block.data = data;
            return data;
        },
        function(err) {
            console.error('FAILED READ BLOCK', block_id, err);
            self.blocks_lru.remove_item(block_id);
            throw err;
        }
    );
};

Agent.prototype.write_block = function(req) {
    var self = this;
    var block_id = req.rest_params.block_id;
    var data = req.rest_params.data;
    var block_path = self._block_path(block_id);
    var old_size = 0;

    console.log('write block', block_id, data.length, typeof(data), self.node_name);

    return Q.fcall(
        function() {
            // remove block data from lru
            var lru_block = self.blocks_lru.remove_item(block_id);
            // using the size from lru data if was cached before
            if (lru_block && lru_block.data) {
                old_size = lru_block.data.length;
                return;
            }
            if (!block_path) {
                throw new Error('NO BLOCK STORAGE');
            }
            // when not in lru we check if the block already exists on fs
            return Q.nfcall(fs.stat, block_path).then(
                function(stats) {
                    old_size = stats.size;
                },
                function(err) {
                    old_size = 0;
                }
            );
        }
    ).then(
        function() {
            // replace the block on fs
            return Q.nfcall(fs.writeFile, block_path, data);
        }
    ).then(
        function() {
            var lru_block = self.blocks_lru.find_or_add_item(block_id);
            lru_block.data = data;
            self.num_blocks += 1;
            self.used_storage += data.length - old_size;
        }
    );
};

Agent.prototype.read_block = function(req) {
    var block_id = req.rest_params.block_id;
    return this._read_block(block_id);
};



Agent.prototype.check_block = function(req) {
    var self = this;
    var block_id = req.rest_params.block_id;
    var slices = req.rest_params.slices;
    return self._read_block(block_id).then(
        function(data) {
            // calculate the md5 of the requested slices
            var md5_hash = crypto.createHash('md5');
            _.each(slices, function(slice) {
                var buf = data.slice(slice.start, slice.end);
                md5_hash.update(buf);
            });
            var md5_sum = md5_hash.digest('hex');
            return {
                checksum: md5_sum
            };
        }
    );
};

Agent.prototype.remove_block = function(req) {
    var self = this;
    var block_id = req.rest_params.block_id;
    self.blocks_lru.remove_item(block_id);
    var block_path = self._block_path(block_id);
    if (block_path) {
        return Q.nfcall(fs.unlink(block_path));
    }
};
