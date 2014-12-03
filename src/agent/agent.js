/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');
var assert = require('assert');
var crypto = require('crypto');
var mkdirp = require('mkdirp');
var express = require('express');
var express_morgan_logger = require('morgan');
var express_body_parser = require('body-parser');
var express_method_override = require('method-override');
var express_compress = require('compression');
var api = require('../api');
var LRUCache = require('../util/lru_cache');
var size_utils = require('../util/size_utils');
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

    self.client = new api.Client();
    assert(params.address, 'missing param: address');
    self.client.options.set_address(params.address);

    assert(params.node_name, 'missing param: node_name');
    self.node_name = params.node_name;
    self.token = params.token;
    self.prefered_port = params.prefered_port;
    self.storage_path = params.storage_path;

    if (self.storage_path) {
        assert(!self.token, 'unexpected param: token. ' +
            'with storage_path the token is expected in the file <storage_path>/token');

        self.storage_path_blocks = path.join(self.storage_path, 'blocks');
        self.store = new AgentStore(self.storage_path_blocks);
        self.store_cache = new LRUCache({
            load: self.store.read_block.bind(self.store),
            max_length: 10,
        });
    } else {
        assert(self.token, 'missing param: token. ' +
            'without storage_path the token must be provided as agent param');

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
        // size limit on raw requests
        limit: 16 * size_utils.MEGABYTE,
        extended: false
    }));
    app.use(express_method_override());
    app.use(express_compress());

    // TODO verify aithorized tokens in agent?
    app.use(function(req, res, next) {
        req.load_auth = function() {};
        next();
    });

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

    // TODO these sample geolocations are just for testing
    self.geolocation = _.sample([
        'United States', 'Canada', 'Brazil', 'Mexico',
        'China', 'Japan', 'Korea', 'India', 'Australia',
        'Israel', 'Romania', 'Russia',
        'Germany', 'England', 'France', 'Spain',
    ]);
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

    return Q.fcall(function() {
            return self._init_node();
        })
        .then(function() {
            return self._start_stop_http_server();
        })
        .then(function() {
            return self.send_heartbeat();
        }).then(function() {
            self._start_stop_heartbeats();
        })
        .then(null, function(err) {
            console.error('AGENT server failed to start', err);
            self.stop();
            throw err;
        });
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
 * _init_node
 *
 */
Agent.prototype._init_node = function() {
    var self = this;

    return Q.fcall(function() {

            // if not using storage_path, a token should be provided
            if (!self.storage_path) return self.token;

            // load the token file
            var token_path = path.join(self.storage_path, 'token');
            return Q.nfcall(fs.readFile, token_path);
        })
        .then(function(token) {

            // use the token as authorization and read the auth info
            self.client.headers.set_auth_token(token);
            return self.client.auth.read_auth();
        })
        .then(function(res) {

            // if we are already authorized with our specific node_id, use it
            if (res.account && res.system &&
                res.extra && res.extra.node_id) {
                self.node_id = res.extra.node_id;
                console.log('authorized node', self.node_name, 'id', self.node_id);
                return;
            }

            // if we have authorization to create a node, do it
            if (res.account && res.system &&
                _.contains(['admin', 'create_node'], res.role) &&
                res.extra && res.extra.tier) {
                console.log('create node', self.node_name, 'tier', res.extra.tier);
                return self.client.node.create_node({
                    name: self.node_name,
                    tier: res.extra.tier,
                    geolocation: self.geolocation,
                    storage_alloc: 0,
                }).then(function(node) {
                    self.node_id = node.id;
                    self.client.headers.set_auth_token(node.token);
                    console.log('created node', self.node_name, 'id', node.id);
                    if (self.storage_path) {
                        console.log('save node token', self.node_name, 'id', node.id);
                        var token_path = path.join(self.storage_path, 'token');
                        return Q.nfcall(fs.writeFile, token_path, node.token);
                    }
                });
            }

            console.error('bad token', res);
            throw new Error('bad token');
        });
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
                self.http_server.listen(self.prefered_port);
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
            return self.client.node.heartbeat({
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
    console.log('AGENT read_block', block_id);
    return self.store_cache.get(block_id);
};

Agent.prototype.write_block = function(req) {
    var self = this;
    var block_id = req.rest_params.block_id;
    var data = req.rest_params.data;
    console.log('AGENT write_block', block_id, data.length);
    self.store_cache.invalidate(block_id);
    return self.store.write_block(block_id, data);
};

Agent.prototype.delete_block = function(req) {
    var self = this;
    var block_id = req.rest_params.block_id;
    console.log('AGENT delete_block', block_id);
    self.store_cache.invalidate(block_id);
    return self.store.delete_block(block_id);
};

Agent.prototype.check_block = function(req) {
    var self = this;
    var block_id = req.rest_params.block_id;
    console.log('AGENT check_block', block_id);
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
