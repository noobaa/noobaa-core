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
var LRUCache = require('../util/lru_cache');
var size_utils = require('../util/size_utils');
var api = require('../api');
var express_morgan_logger = require('morgan');
var express_body_parser = require('body-parser');
var express_method_override = require('method-override');
var express_compress = require('compression');
var os = require('os');
var api = require('../api');
var AgentStore = require('./agent_store');

module.exports = Agent;


/**
 *
 * AGENT
 *
 * the glorious noobaa agent.
 *
 */
function Agent(params) {
    var self = this;
    assert(params.token, 'missing params.token');
    assert(params.node_id, 'missing params.node_id');
    assert(params.geolocation, 'missing params.geolocation');
    self.token = params.token;
    self.node_id = params.node_id;
    self.geolocation = params.geolocation;
    self.node_client = new api.node_api.Client();
    self.node_client.set_authorization(self.token);

    self.storage_path = params.storage_path;
    var lru_options = {};
    if (self.storage_path) {
        self.storage_path_node = path.join(self.storage_path, self.node_id);
        self.storage_path_blocks = path.join(self.storage_path_node, 'blocks');
        self.store = new AgentStore(self.storage_path_blocks);
        self.store_cache = new LRUCache({
            load: self.store.read_block.bind(self.store),
            max_length: 10,
        });
    } else {
        this.store = new AgentStore.MemoryStore();
        self.store_cache = new LRUCache({
            load: self.store.read_block.bind(self.store),
            max_length: 1,
        });
    }

    var app = express();
    app.use(express_morgan_logger('dev'));
    app.use(express_body_parser.json());
    app.use(express_body_parser.raw({
        // size limit on raw requests
        limit: 16 * size_utils.MEGABYTE
    }));
    app.use(express_body_parser.text());
    app.use(express_body_parser.urlencoded({
        extended: false
    }));
    app.use(express_method_override());
    app.use(express_compress());
    // enable CORS for agent api
    app.use('/api', function(req, res, next) {
        res.header('Access-Control-Allow-Methods', 'POST, GET, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type');
        res.header('Access-Control-Allow-Origin', '*');
        // note that browsers will not allow origin=* with credentials
        // but anyway we allow it by the agent server.
        res.header('Access-Control-Allow-Credentials', true);
        next();
    });

    var agent_server = new api.agent_api.Server({
        write_block: self.write_block.bind(self),
        read_block: self.read_block.bind(self),
        check_block: self.check_block.bind(self),
        delete_block: self.delete_block.bind(self),
    });
    agent_server.install_rest(app);

    var http_server = http.createServer(app);
    http_server.on('listening', self._server_listening_handler.bind(self));
    http_server.on('close', self._server_close_handler.bind(self));
    http_server.on('error', self._server_error_handler.bind(self));

    self.agent_app = app;
    self.agent_server = agent_server;
    self.http_server = http_server;
    self.http_port = 0;
}


/**
 *
 * START
 *
 */
Agent.prototype.start = function() {
    var self = this;

    self.is_started = true;
    console.log('start agent', self.node_id);

    return Q.fcall(
        function() {
            return self._mkdirs();
        }
    ).then(
        function() {
            return self._start_stop_http_server();
        }
    ).then(
        function() {
            return self.send_heartbeat();
        }
    ).then(
        function() {
            self._start_stop_heartbeats();
        }
    ).then(null,
        function(err) {
            console.error('AGENT server failed to start', err);
            self.stop();
            throw err;
        }
    );
};


/**
 *
 * STOP
 *
 */
Agent.prototype.stop = function() {
    var self = this;
    console.log('stop agent', self.node_id);
    self.is_started = false;
    self._start_stop_http_server();
    self._start_stop_heartbeats();
};


/**
 *
 * _mkdirs
 *
 */
Agent.prototype._mkdirs = function() {
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



// HTTP SERVER ////////////////////////////////////////////////////////////////


/**
 *
 * _start_stop_http_server
 *
 */
Agent.prototype._start_stop_http_server = function() {
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


/**
 *
 * _server_listening_handler
 *
 */
Agent.prototype._server_listening_handler = function() {
    this.http_port = this.http_server.address().port;
    console.log('AGENT server listening on port', this.http_port);
};


/**
 *
 * _server_close_handler
 *
 */
Agent.prototype._server_close_handler = function() {
    console.log('AGENT server closed');
    this.http_port = 0;
    // set timer to check the state and react by restarting or not
    setTimeout(this._start_stop_http_server.bind(this), 1000);
};


/**
 *
 * _server_error_handler
 *
 */
Agent.prototype._server_error_handler = function(err) {
    // the server will also trigger close event after
    console.error('AGENT server error', err);
};




// HEARTBEATS /////////////////////////////////////////////////////////////////



/**
 *
 * send_heartbeat
 *
 */
Agent.prototype.send_heartbeat = function() {
    var self = this;
    var store_stats;
    console.log('send heartbeat by agent', self.node_id);

    return Q.when(self.store.get_stats())
        .then(function(store_stats_arg) {
            store_stats = store_stats_arg;
            return self.node_client.heartbeat({
                id: self.node_id,
                geolocation: self.geolocation,
                // ip: '',
                port: self.http_port,
                storage: {
                    alloc: store_stats.alloc,
                    used: store_stats.used,
                },
                device_info: {
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
            });
        })
        .then(function(res) {

            // report only if used storage mismatch
            // TODO compare with some accepted error and handle
            if (store_stats.used !== res.storage.used) {
                console.log('AGENT used storage not in sync',
                    store_stats.used, 'expected', res.storage.used);
            }

            // update the store when allocated size change
            if (store_stats.alloc !== res.storage.alloc) {
                console.log('AGENT update alloc storage from',
                    store_stats.alloc, 'to', res.storage.alloc);
                self.store.set_alloc(res.storage.alloc);
            }
        });
};


/**
 *
 * _start_stop_heartbeats
 *
 */
Agent.prototype._start_stop_heartbeats = function() {
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



// AGENT API //////////////////////////////////////////////////////////////////



Agent.prototype.read_block = function(req) {
    var self = this;
    var block_id = req.rest_params.block_id;
    return self.store_cache.get(block_id);
};

Agent.prototype.write_block = function(req) {
    var self = this;
    var block_id = req.rest_params.block_id;
    var data = req.rest_params.data;
    self.store_cache.invalidate(block_id);
    return self.store.write_block(block_id);
};

Agent.prototype.delete_block = function(req) {
    var self = this;
    var block_id = req.rest_params.block_id;
    self.store_cache.invalidate(block_id);
    return self.store.delete_block(block_id);
};

Agent.prototype.check_block = function(req) {
    var self = this;
    var block_id = req.rest_params.block_id;
    var slices = req.rest_params.slices;
    return self.store_cache.get(block_id)
        .then(function(data) {
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
        });
};
