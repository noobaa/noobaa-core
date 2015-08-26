/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var fs = require('fs');
var pem = require('pem');
var path = require('path');
var http = require('http');
var https = require('https');
var assert = require('assert');
var express = require('express');
var express_morgan_logger = require('morgan');
var express_body_parser = require('body-parser');
var express_method_override = require('method-override');
var express_compress = require('compression');
var ip_module = require('ip');
var api = require('../api');
var dbg = require('noobaa-util/debug_module')(__filename);
var LRUCache = require('../util/lru_cache');
var size_utils = require('../util/size_utils');
var promise_utils = require('../util/promise_utils');
var os_util = require('../util/os_util');
var diag = require('./agent_diagnostics');
var AgentStore = require('./agent_store');
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

    self.rpc = api.new_rpc();
    if (params.address) {
        self.rpc.base_address = params.address;
    }
    self.client = self.rpc.client;
    self.rpc.on('reconnect', self._on_rpc_reconnect.bind(self));

    assert(params.node_name, 'missing param: node_name');
    self.node_name = params.node_name;
    self.token = params.token;
    self.prefered_port = params.prefered_port;
    self.prefered_secure_port = params.prefered_secure_port;
    self.storage_path = params.storage_path;

    if (self.storage_path) {
        assert(!self.token, 'unexpected param: token. ' +
            'with storage_path the token is expected in the file <storage_path>/token');

        self.store = new AgentStore(self.storage_path);
        self.store_cache = new LRUCache({
            name: 'AgentBlocksCache',
            max_length: 200, // ~200 MB
            expiry_ms: 0, // no expiry
            make_key: function(params) {
                return params.id;
            },
            load: self.store.read_block.bind(self.store)
        });
    } else {
        assert(self.token, 'missing param: token. ' +
            'without storage_path the token must be provided as agent param');

        this.store = new AgentStore.MemoryStore();
        self.store_cache = new LRUCache({
            name: 'AgentBlocksCache',
            max_length: 1,
            expiry_ms: 0, // no expiry
            make_key: function(params) {
                return params.id;
            },
            load: self.store.read_block.bind(self.store)
        });
    }

    self.agent_server = {
        write_block: self.write_block.bind(self),
        read_block: self.read_block.bind(self),
        replicate_block: self.replicate_block.bind(self),
        delete_blocks: self.delete_blocks.bind(self),
        kill_agent: self.kill_agent.bind(self),
        n2n_signal: self.n2n_signal.bind(self),
        self_test_io: self.self_test_io.bind(self),
        self_test_peer: self.self_test_peer.bind(self),
        collect_diagnostics: self.collect_diagnostics.bind(self),
        set_debug_node: self.set_debug_node.bind(self),
    };

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
    self.rpc.register_http_transport(app);
    self.agent_app = app;

    // TODO these sample geolocations are just for testing
    self.geolocation = _.sample([
        'United States', 'Canada',
        'Brazil',
        'China', 'Japan', 'Korea',
        'Ireland', 'Germany',
    ]);

    //If test, add test APIs
    if (config.test_mode) {
        self._add_test_APIs();
    }
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

            // register agent_server in rpc, with peer as my peer_id
            // to match only calls to me
            self.rpc.register_service(api.schema.agent_api, self.agent_server, {
                authorize: function(req, method_api) {
                    // TODO verify aithorized tokens in agent?
                }
            });

        })
        .then(function() {
            return self._start_stop_http_server();
        })
        .then(function() {
            return self.rpc.register_n2n_transport();
        })
        .then(function() {
            return self.send_heartbeat();
        })
        .then(null, function(err) {
            dbg.error('server failed to start', err.stack || err);
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
    dbg.log0('stop agent ' + self.node_id);
    self.is_started = false;
    self._start_stop_http_server();
    self._start_stop_heartbeats();
    self.rpc.disconnect_all();
};



/**
 *
 * _init_node
 *
 */
Agent.prototype._init_node = function() {
    var self = this;

    return Q.fcall(function() {
            if (self.storage_path) {
                return os_util.get_mount_of_path(self.storage_path);
            }
        })
        .then(function(storage_path_mount) {
            self.storage_path_mount = storage_path_mount;
            dbg.log0('storage_path_mount', storage_path_mount);

            // if not using storage_path, a token should be provided
            if (!self.storage_path) return self.token;

            // load the token file
            var token_path = path.join(self.storage_path, 'token');
            return Q.nfcall(fs.readFile, token_path);
        })
        .then(function(token) {
            // use the token as authorization and read the auth info
            self.client.options.auth_token = token.toString();
            return self.client.auth.read_auth();
        })
        .then(function(res) {
            dbg.log0('res:', res);
            // if we are already authorized with our specific node_id, use it
            if (res.system &&
                res.extra && res.extra.node_id) {
                self.node_id = res.extra.node_id;
                self.peer_id = res.extra.peer_id;
                dbg.log0('authorized node ' + self.node_name +
                    ' id ' + self.node_id + ' peer_id ' + self.peer_id);
                return;
            }

            // if we have authorization to create a node, do it
            if (res.system &&
                _.contains(['admin', 'create_node'], res.role) &&
                res.extra && res.extra.tier) {
                dbg.log0('create node', self.node_name, 'tier', res.extra.tier);
                return self.client.node.create_node({
                    name: self.node_name,
                    tier: res.extra.tier,
                    geolocation: self.geolocation,
                }).then(function(node) {
                    self.node_id = node.id;
                    self.peer_id = node.peer_id;
                    self.client.options.auth_token = node.token;
                    dbg.log0('created node', self.node_name, 'id', node.id, 'peer_id', self.peer_id);
                    if (self.storage_path) {
                        dbg.log0('save node token', self.node_name, 'id', node.id);
                        var token_path = path.join(self.storage_path, 'token');
                        return Q.nfcall(fs.writeFile, token_path, node.token);
                    }
                });
            }

            dbg.error('bad token', res);
            throw new Error('bad token');
        });
};


// RPC SERVER /////////////////////////////////////////////////////////////////


/**
 *
 * _start_stop_http_server
 *
 */
Agent.prototype._start_stop_http_server = function() {
    var self = this;

    if (!self.is_started) {
        if (self.http_server) {
            // close event will also nullify the pointer (see below)
            self.http_server.close();
        }
        if (self.https_server) {
            // close event will also nullify the pointer (see below)
            self.https_server.close();
        }
        return;
    }

    return Q.fcall(function() {
            return Q.nfcall(pem.createCertificate, {
                days: 365 * 100,
                selfSigned: true
            });
        })
        .then(function(cert) {
            var promises = [];

            if (!self.http_server) {
                self.http_server = http.createServer(self.agent_app)
                    .on('error', function(err) {
                        dbg.error('HTTP SERVER ERROR', err.stack || err);
                    })
                    .on('close', function() {
                        dbg.warn('HTTP SERVER CLOSED');
                        self.http_server = null;
                        setTimeout(self._start_stop_http_server.bind(this), 1000);
                    });
                promises.push(
                    Q.ninvoke(self.http_server, 'listen', self.prefered_port));
            }

            if (!self.https_server) {
                self.https_server = https.createServer({
                        key: cert.serviceKey,
                        cert: cert.certificate
                    }, self.agent_app)
                    .on('error', function(err) {
                        dbg.error('HTTPS SERVER ERROR', err.stack || err);
                    })
                    .on('close', function() {
                        dbg.warn('HTTPS SERVER CLOSED');
                        self.https_server = null;
                        setTimeout(self._start_stop_http_server.bind(this), 1000);
                    });
                promises.push(
                    Q.ninvoke(self.https_server, 'listen', self.prefered_secure_port));
            }

            self.rpc.register_ws_transport(self.http_server);
            self.rpc.register_ws_transport(self.https_server);

            return Q.all(promises);
        });
};


/**
 *
 * _server_error_handler
 *
 */
Agent.prototype._server_error_handler = function(err) {
    // the server will also trigger close event after
    dbg.error('server error', err);
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
    var extended_hb;

    var EXTENDED_HB_PERIOD = 3600000;
    // var EXTENDED_HB_PERIOD = 1000;
    if (!self.extended_hb_last_time ||
        Date.now() > self.extended_hb_last_time + EXTENDED_HB_PERIOD) {
        extended_hb = true;
    }

    dbg.log0('send heartbeat from node', self.node_name);

    return Q.when(self.store.get_stats())
        .then(function(store_stats_arg) {
            store_stats = store_stats_arg;

            if (extended_hb) {
                return Q.fcall(os_util.read_drives)
                    .then(function(drives_arg) {
                        self.drives = drives_arg;
                    }, function(err) {
                        dbg.error('read_drives: ERROR', err.stack || err);
                    });
            }
        })
        .then(function() {

            var ip = ip_module.address();
            var https_port = self.https_server && self.https_server.address().port;
            // var http_port = self.http_server && self.http_server.address().port;

            var params = {
                id: self.node_id,
                geolocation: self.geolocation,
                ip: ip,
                port: https_port || 0,
                version: self.heartbeat_version || '',
                storage: {
                    alloc: store_stats.alloc,
                    used: store_stats.used
                },
            };

            if (extended_hb) {
                params.os_info = os_util.os_info();
                if (self.drives) {
                    params.drives = self.drives;

                    // for now we only use a single drive,
                    // so mark the usage on the drive of our storage folder.
                    _.each(self.drives, function(drive) {
                        if (self.storage_path_mount === drive.mount) {
                            drive.storage.used = store_stats.used;
                        }
                    });
                }
            }

            dbg.log0('heartbeat params:', params, 'node', self.node_name);

            return self.client.node.heartbeat(params);
        })
        .then(function(res) {
            if (extended_hb) {
                self.extended_hb_last_time = Date.now();
            }

            if (res.storage) {
                // report only if used storage mismatch
                // TODO compare with some accepted error and handle
                if (store_stats.used !== res.storage.used) {
                    dbg.log0('used storage not in sync ',
                        store_stats.used, ' expected ', res.storage.used);
                }

                // update the store when allocated size change
                if (store_stats.alloc !== res.storage.alloc) {
                    dbg.log0('update alloc storage from ',
                        store_stats.alloc, ' to ', res.storage.alloc);
                    self.store.set_alloc(res.storage.alloc);
                }
            }
            dbg.log0('res.version:', res.version,
                'hb version:', self.heartbeat_version,
                'node', self.node_name);

            if (res.version && self.heartbeat_version && self.heartbeat_version !== res.version) {
                dbg.log0('version changed, exiting');
                process.exit(0);
            }
            self.heartbeat_version = res.version;
            self.heartbeat_delay_ms = res.delay_ms;

        }, function(err) {

            dbg.error('HEARTBEAT FAILED', err, err.stack, 'node', self.node_name);

            // schedule delay to retry on error
            self.heartbeat_delay_ms = 30000 * (1 + Math.random());

        }).fin(function() {
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


/**
 *
 * _on_rpc_reconnect
 *
 * rpc will notify on reconnect so we can send new heartbeat
 * this will make sure that the server will recognize the connection with us,
 * which is needed for signaling to work.
 *
 */
Agent.prototype._on_rpc_reconnect = function(conn) {

    // NOTE: reconnect even is only triggered for the base address by rpc,
    // so we don't need to check that again here.

    // 1 ms just to be small but non zero to run immediately
    this.heartbeat_delay_ms = 1;
    this._start_stop_heartbeats();
};



// AGENT API //////////////////////////////////////////////////////////////////


Agent.prototype.read_block = function(req) {
    var self = this;
    var block_md = req.rpc_params.block_md;
    dbg.log1('read_block', block_md.id, 'node', self.node_name);
    return self.store_cache.get(block_md)
        .then(function(block_from_cache) {
            // must clone before returning to rpc encoding
            // since it mutates the object for encoding buffers
            return _.clone(block_from_cache);
        }, function(err) {
            if (err === AgentStore.TAMPERING_ERROR) {
                err = req.rpc_error('INTERNAL', 'TAMPERING');
            }
            throw err;
        });
};

Agent.prototype.write_block = function(req) {
    var self = this;
    var block_md = req.rpc_params.block_md;
    var data = req.rpc_params.data;
    dbg.log1('write_block', block_md.id, data.length, 'node', self.node_name);
    return Q.when(self.store.write_block(block_md, data))
        .then(function() {
            self.store_cache.put(block_md, {
                block_md: block_md,
                data: data
            });
        }, function() {
            self.store_cache.invalidate(block_md);
        });
};

Agent.prototype.replicate_block = function(req) {
    var self = this;
    var target = req.rpc_params.target;
    var source = req.rpc_params.source;
    dbg.log1('replicate_block', target.id, 'node', self.node_name);

    // read from source agent
    return self.client.agent.read_block({
            block_md: source
        }, {
            address: source.address,
        })
        .then(function(res) {
            self.store_cache.invalidate(target);
            return self.store.write_block(target, res.data);
        });
};

Agent.prototype.delete_blocks = function(req) {
    var self = this;
    var blocks = req.rpc_params.blocks;
    dbg.log0('delete_blocks', blocks, 'node', self.node_name);
    self.store_cache.multi_invalidate(blocks);
    return self.store.delete_blocks(blocks);
};

Agent.prototype.kill_agent = function(req) {
    dbg.log0('kill requested, exiting');
    process.exit();
};

Agent.prototype.n2n_signal = function(req) {
    return this.rpc.n2n_signal(req.rpc_params);
};

Agent.prototype.self_test_io = function(req) {
    var data = req.rpc_params.data;
    var req_len = data ? data.length : 0;
    var res_len = req.rpc_params.response_length;

    dbg.log0('SELF_TEST_IO',
        'req_len', req_len,
        'res_len', res_len);

    return {
        data: new Buffer(res_len)
    };
};

Agent.prototype.self_test_peer = function(req) {
    var self = this;
    var target = req.rpc_params.target;
    var req_len = req.rpc_params.request_length;
    var res_len = req.rpc_params.response_length;

    dbg.log0('SELF_TEST_PEER',
        'req_len', req_len,
        'res_len', res_len,
        'target', target);

    // read/write from target agent
    return self.client.agent.self_test_io({
            data: new Buffer(req_len),
            response_length: res_len,
        }, {
            address: target,
        })
        .then(function(res) {
            var data = res.data;
            if (((!data || !data.length) && res_len > 0) ||
                (data && data.length && data.length !== res_len)) {
                throw new Error('SELF TEST PEER response_length mismatch');
            }
        });
};

Agent.prototype.collect_diagnostics = function(req) {
    dbg.log1('Recieved diag req', req);
    var inner_path = '/tmp/agent_diag.tgz';
    return Q.fcall(function() {
            return diag.collect_agent_diagnostics();
        })
        .then(function() {
            return diag.pack_diagnostics(inner_path);
        })
        .then(function() {
            dbg.log1('Reading packed file');
            return Q.nfcall(fs.readFile, inner_path)
                .then(function(data) {
                    return {
                        data: data,
                    };
                })
                .then(null, function(err) {
                    dbg.error('DIAGNOSTICS READ FAILED', err.stack || err);
                    throw new Error('Agent Collect Diag Error on reading packges diag file');
                });
        })
        .then(null, function() {
            return '';
        });
};

Agent.prototype.set_debug_node = function(req) {
    dbg.set_level(5, 'core');
    dbg.log1('Recieved set debug req', req);

    promise_utils.delay_unblocking(1000 * 10) //10m
        .then(function() {
            dbg.set_level(0, 'core');
        });
    return '';
};


// AGENT TEST API /////////////////////////////////////////////////////////////

Agent.prototype._add_test_APIs = function() {
    dbg.warn("Adding test APIs for Agent prototype");

    Agent.prototype.corrupt_blocks = function(req) {
        var self = this;
        var blocks = req.rpc_params.blocks;
        dbg.log0('TEST API corrupt_blocks', blocks);
        return self.store.corrupt_blocks(blocks);
    };

    Agent.prototype.list_blocks = function() {
        var self = this;
        dbg.log0('TEST API list_blocks');
        return self.store.list_blocks();
    };
};
