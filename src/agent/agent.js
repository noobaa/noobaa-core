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
var ifconfig = require('../util/ifconfig');
var AgentStore = require('./agent_store');
var ice_api = require('../util/ice_api');
var config = require('../../config.js');

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
    self.use_http_server = params.use_http_server;

    if (self.storage_path) {
        assert(!self.token, 'unexpected param: token. ' +
            'with storage_path the token is expected in the file <storage_path>/token');

        self.store = new AgentStore(self.storage_path);
        self.store_cache = new LRUCache({
            name: 'AgentBlocksCache',
            max_length: 10,
            load: self.store.read_block.bind(self.store)
        });
    } else {
        assert(self.token, 'missing param: token. ' +
            'without storage_path the token must be provided as agent param');

        this.store = new AgentStore.MemoryStore();
        self.store_cache = new LRUCache({
            name: 'AgentBlocksCache',
            max_length: 1,
            load: self.store.read_block.bind(self.store)
        });
    }

    var app = express();
    app.use(express_morgan_logger('dev'));
    app.use(express_body_parser.json());
    app.use(express_body_parser.raw({
        // increase size limit on raw requests to allow serving data blocks
        limit: 4 * size_utils.MEGABYTE
    }));
    app.use(express_body_parser.text());
    app.use(express_body_parser.urlencoded({
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
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.header('Access-Control-Allow-Origin', '*');
        // note that browsers will not allow origin=* with credentials
        // but anyway we allow it by the agent server.
        res.header('Access-Control-Allow-Credentials', true);
        if (req.method === 'OPTIONS') {
            res.send(200);
        } else {
            next();
        }
    });

    var agent_server = new api.agent_api.Server({
        write_block: self.write_block.bind(self),
        read_block: self.read_block.bind(self),
        replicate_block: self.replicate_block.bind(self),
        delete_block: self.delete_block.bind(self),
        check_block: self.check_block.bind(self),
        kill_agent: self.kill_agent.bind(self),
    });
    self.agent_server = agent_server;
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
        'Germany', 'England', 'France', 'Spain'
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

    return Q.fcall(function() {
            return self._init_node();
        })
        .then(function() {
            return self._start_stop_http_server();
        })
        .then(function() {
            if (config.use_ice_when_possible || config.use_ws_when_possible) {
                console.log('start ws agent id: '+ self.node_id+' peer id: '+ self.peer_id);

                self.sigSocket = ice_api.signalingSetup(
                    self.agent_server.ice_server_handler.bind(self.agent_server),
                    self.peer_id);
                self.client.options.set_ws(self.sigSocket);
                return self.sigSocket;
            }
        })
        .then(function() {
            return self.send_heartbeat();
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
    console.log('stop agent '+ self.node_id);
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
                self.peer_id = res.extra.peer_id;
                console.log('authorized node '+ self.node_name+
                    ' id '+ self.node_id+ ' peer_id '+ self.peer_id);
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
                    storage_alloc: 100 * size_utils.GIGABYTE
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
        if (!self.http_port && self.use_http_server) {
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
    console.log('AGENT server listening on port '+ this.http_port);
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
    var device_info_send_time;
    console.log('send heartbeat by agent', self.node_id,self.http_port);
    if (self.http_port===0){
        self.http_port = Math.floor(Math.random() * (60000 - 20000) + 20000);
    }
    return Q.when(self.store.get_stats())
        .then(function(store_stats_arg) {
            store_stats = store_stats_arg;
            var ip = ifconfig.get_main_external_ipv4();
            var params = {
                id: self.node_id,
                geolocation: self.geolocation,
                ip: ip,
                port: self.http_port,
                storage: {
                    alloc: store_stats.alloc,
                    used: store_stats.used
                }
            };
            var now_time = Date.now();
            if (!self.device_info_send_time ||
                now_time > self.device_info_send_time + 3600000) {
                device_info_send_time = now_time;
                params.device_info = {
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
                    networkInterfaces: os.networkInterfaces()
                };
            }
            return self.client.node.heartbeat(params);
        })
        .then(function(res) {
            if (device_info_send_time) {
                self.device_info_send_time = device_info_send_time;
            }

            if (res.storage) {
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
            }

            if (res.version && self.heartbeat_version && self.heartbeat_version !== res.version) {
                console.log('AGENT version changed, exiting');
                process.exit();
            }
            self.heartbeat_version = res.version;
            self.heartbeat_delay_ms = res.delay_ms;

        }, function(err) {

            console.error('HEARTBEAT FAILED', err);

            // schedule delay to retry on error
            self.heartbeat_delay_ms = 30000 * (1 + Math.random());

        })['finally'](function() {
            self._start_stop_heartbeats();
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
    clearTimeout(self.heartbeat_timeout);
    self.heartbeat_timeout = null;

    // set the timer when started
    if (self.is_started) {
        var ms = self.heartbeat_delay_ms;
        ms = ms || (60000 * (1 + Math.random())); // default 1 minute
        ms = Math.max(ms, 1000); // force above 1 second
        ms = Math.min(ms, 300000); // force below 5 minutes
        self.heartbeat_timeout = setTimeout(self.send_heartbeat.bind(self), ms);
    }
};



// AGENT API //////////////////////////////////////////////////////////////////



Agent.prototype.read_block = function(req) {
    var self = this;
    var block_id = req.rest_params.block_id;
    console.log('AGENT read_block', block_id);
    return self.store_cache.get(block_id)
        .then(null, function(err) {
            if (err === 'TAMPERING DETECTED') {
                err = req.rest_error(500, 'TAMPERING DETECTED');
            }
            throw err;
        });
};

Agent.prototype.write_block = function(req) {
    var self = this;
    var block_id = req.rest_params.block_id;
    var data = req.rest_params.data;
    console.log('AGENT write_block', block_id, data.length);
    self.store_cache.invalidate(block_id);
    return self.store.write_block(block_id, data);
};

Agent.prototype.replicate_block = function(req) {
    var self = this;
    var block_id = req.rest_params.block_id;
    var source = req.rest_params.source;
    console.log('AGENT replicate_block', block_id);
    self.store_cache.invalidate(block_id);

    if (!self.p2p_context) {
        self.p2p_context = {};
    }

    // read from source agent
    var agent = new api.agent_api.Client();
    agent.options.set_address(source.host);
    agent.options.set_peer(source.peer);
    agent.options.set_ws(self.sigSocket);
    agent.options.set_p2p_context(self.p2p_context);
    return agent.read_block({
            block_id: source.id
        })
        .then(function(data) {
            return self.store.write_block(block_id, data);
        });
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

Agent.prototype.kill_agent = function(req) {
    console.log('AGENT kill requested, exiting');
    process.exit();
};
