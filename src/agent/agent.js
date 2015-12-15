/* jshint node:true */
'use strict';

var _ = require('lodash');
var P = require('../util/promise');
var fs = require('fs');
var pem = require('../util/pem');
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
var dbg = require('../util/debug_module')(__filename);
var LRUCache = require('../util/lru_cache');
var size_utils = require('../util/size_utils');
var url_utils = require('../util/url_utils');
var promise_utils = require('../util/promise_utils');
var os_util = require('../util/os_util');
var diag = require('./agent_diagnostics');
var AgentStore = require('./agent_store');
var config = require('../../config.js');
//var cluster = require('cluster');
//var numCPUs = require('os').cpus().length;



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

    dbg.log0('process.env.DEBUG_MODE=' + process.env.DEBUG_MODE);

    self.rpc = api.new_rpc();
    if (params.address) {
        self.rpc.base_address = params.address;
    }
    self.client = self.rpc.client;

    self.rpc.on('reconnect', self._on_rpc_reconnect.bind(self));
    assert(params.node_name, 'missing param: node_name');
    self.node_name = params.node_name;
    self.token = params.token;
    self.storage_path = params.storage_path;

    self.all_storage_paths = params.all_storage_paths;
    if (self.storage_path) {
        assert(!self.token, 'unexpected param: token. ' +
            'with storage_path the token is expected in the file <storage_path>/token');
        self.store = [];
        //        self.store_cache = [];
        dbg.log0('creating storage paths:', self.storage_path);
        //        self.store[self.storage_path] = new AgentStore(self.storage_path);
        //        self.store_cache[self.storage_path] = new LRUCache({
        self.store.push({
            storage_path: self.storage_path,
            agent_store: new AgentStore(self.storage_path)
        });
        dbg.log0('creating self.store:', self.store);

        self.store_cache = new LRUCache({
            name: 'AgentBlocksCache',
            max_length: 200, // ~200 MB
            expiry_ms: 0, // no expiry
            make_key: function(params) {
                return params.id;
            },
            load: self.store[0].agent_store.read_block.bind(self.store[0].agent_store)
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
            load: self.store[0].agent_store.read_block.bind(self.store)
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

    self.agent_app = (function() {
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
        return app;
    })();

    // register rpc to serve the agent_api
    self.rpc.register_service(api.schema.agent_api, self.agent_server, {
        authorize: function(req, method_api) {
            // TODO verify aithorized tokens in agent?
        }
    });
    // register rpc http server
    self.rpc.register_http_transport(self.agent_app);
    // register rpc n2n
    self.n2n_agent = self.rpc.register_n2n_transport();

    // TODO these sample geolocations are just for testing
    self.geolocation = _.sample([
        // aws
        'North Virginia',
        'North California',
        'Oregon',
        'Ireland',
        'Frankfurt',
        'Singapore',
        'Sydney',
        'Tokyo',
        'Sao Paulo',
        // google cloud
        'Iowa',
        'Belgium',
        'Taiwan',
    ]);

    // If test, add test APIs
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

    return P.fcall(function() {
            return self._init_node();
        })
        .then(function() {
            return self._do_heartbeat();
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
    dbg.log0('stop agent ' + self.node_name);
    self.is_started = false;
    self._start_stop_server();
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
    self.node_storage_mapping = [];

    var root_path = self.all_storage_paths[0].mount.replace('./', '');
    dbg.log0('starting agent. root_path:' + Object.prototype.toString.call(root_path.substr(0, root_path.length - 1)) + '=?=' + Object.prototype.toString.call(self.storage_path.substr(0, root_path.length - 1)));
    var waitFor;
    //substr is required in order to ignore win/linux conventions
    if (self.storage_path.substr(0, root_path.length - 1) === root_path.substr(0, root_path.length - 1)) {
        dbg.log0('main agent!!!', root_path, ' all paths:', self.all_storage_paths);

        waitFor = P.all(_.map(self.all_storage_paths, function(storage_path_info) {
            var storage_path = storage_path_info.mount;
            dbg.log0('current path is:', storage_path);
            return P.fcall(function() {
                    return P.nfcall(fs.readdir, storage_path);
                })
                .then(function(node_name) {
                    if (node_name.length > 0) {
                        dbg.log0('node_name', node_name[0], 'storage_path', storage_path);
                        var node_path = path.join(storage_path, node_name[0]);
                        if (storage_path !== root_path) {
                            self.store[node_path] = new AgentStore(node_path);
                        }
                        self.node_storage_mapping.push({
                            node_name: node_name[0],
                            storage_path: node_path
                        });
                    }
                });
        }));
    }

    return P.fcall(function() {
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
            return fs.readFileAsync(token_path);
        })
        .then(function(token) {
            // use the token as authorization (either 'create_node' or 'agent' role)
            self.client.options.auth_token = token.toString();
            return P.nfcall(pem.createCertificate, {
                days: 365 * 100,
                selfSigned: true
            });
        })
        .then(function(pem_cert) {
            self.ssl_cert = {
                key: pem_cert.serviceKey,
                cert: pem_cert.certificate
            };
            // update the n2n ssl to use my certificate
            self.n2n_agent.set_ssl_context(self.ssl_cert);
        });
};


// RPC SERVER /////////////////////////////////////////////////////////////////


/**
 *
 * _start_stop_server
 *
 */
Agent.prototype._start_stop_server = function() {
    var self = this;

    // in any case we stop
    self.n2n_agent.reset_rpc_address();
    if (self.server) {
        self.server.close();
        self.server = null;
    }

    if (!self.is_started) return;
    if (!self.rpc_address) return;

    var addr_url = url_utils.quick_parse(self.rpc_address);
    switch (addr_url.protocol) {
        case 'n2n:':
            self.n2n_agent.set_rpc_address(addr_url.href);
            break;
        case 'http:':
        case 'ws:':
            var http_server = http.createServer(self.agent_app)
                .on('error', function(err) {
                    dbg.error('AGENT HTTP SERVER ERROR', err.stack || err);
                    http_server.close();
                })
                .on('close', function() {
                    dbg.warn('AGENT HTTP SERVER CLOSED');
                    retry();
                })
                .listen(addr_url.port);
            if (addr_url.protocol === 'ws:') {
                self.rpc.register_ws_transport(http_server);
            }
            self.server = http_server;
            break;
        case 'https:':
        case 'wss:':
            var https_server = https.createServer(self.ssl_cert, self.agent_app)
                .on('error', function(err) {
                    dbg.error('AGENT HTTPS SERVER ERROR', err.stack || err);
                    https_server.close();
                })
                .on('close', function() {
                    dbg.warn('AGENT HTTPS SERVER CLOSED');
                    retry();
                })
                .listen(addr_url.port);
            if (addr_url.protocol === 'wss:') {
                self.rpc.register_ws_transport(https_server);
            }
            self.server = https_server;
            break;
        case 'tcp:':
            var tcp_server = self.rpc.register_tcp_transport(addr_url.port);
            tcp_server.on('close', function() {
                dbg.warn('AGENT TCP SERVER CLOSED');
                retry();
            });
            self.server = tcp_server;
            break;
        case 'tls:':
            var tls_server = self.rpc.register_tcp_transport(addr_url.port, self.ssl_cert);
            tls_server.on('close', function() {
                dbg.warn('AGENT TLS SERVER CLOSED');
                retry();
            });
            self.server = tls_server;
            break;
        default:
            dbg.error('UNSUPPORTED AGENT PROTOCOL', addr_url);
            break;
    }

    function retry() {
        if (self.is_started) {
            setTimeout(self._start_stop_server.bind(self), 1000);
        }
    }
};




// HEARTBEATS /////////////////////////////////////////////////////////////////



/**
 *
 * _do_heartbeat
 *
 */
Agent.prototype._do_heartbeat = function() {
    var self = this;
    var store_stats;
    var extended_hb = false;

    var EXTENDED_HB_PERIOD = 3600000;
    // var EXTENDED_HB_PERIOD = 1000;
    if (!self.extended_hb_last_time ||
        Date.now() > self.extended_hb_last_time + EXTENDED_HB_PERIOD) {
        extended_hb = true;
    }
    dbg.log0('send heartbeat from node', self.node_name, self.all_storage_paths);

    return P.when(self.store[0].agent_store.get_stats())
        .then(function(store_stats_arg) {
            store_stats = store_stats_arg;
            dbg.log0('store_stats:', store_stats);
            if (extended_hb) {
                return P.fcall(os_util.read_drives)
                    .then(function(drives_arg) {
                        self.drives = drives_arg;
                        dbg.log0('d args:', drives_arg);
                    }, function(err) {
                        dbg.error('read_drives: ERROR', err.stack || err);
                    });
            }
        })
        .then(function() {

            var ip = ip_module.address();
            var params = {
                name: self.node_name || '',
                geolocation: self.geolocation,
                ip: ip,
                version: self.heartbeat_version || '',
                extended_hb: extended_hb,
                storage: {
                    alloc: store_stats.alloc,
                    used: store_stats.used
                },
            };

            if (self.rpc_address) {
                params.rpc_address = self.rpc_address;
            }

            if (extended_hb) {
                params.os_info = os_util.os_info();
                if (self.drives) {
                    params.drives = self.drives;

                    // for now we only use a single drive,
                    // so mark the usage on the drive of our storage folder.
                    var used_drives = _.filter(self.drives, function(drive) {
                        if (self.storage_path_mount === drive.mount) {
                            drive.storage.used = store_stats.used;
                            return true;
                        } else {
                            return false;
                        }
                    });
                    self.drives = used_drives;
                    dbg.log0('DRIVES:', self.drives, 'NBNBNBN', used_drives);
                    // _.each(self.drives, function(drive) {
                    //     if (self.storage_path_mount === drive.mount) {
                    //         drive.storage.used = store_stats.used;
                    //     }
                    // });
                }
            }

            dbg.log0('heartbeat params:', params, 'node', self.node_name);

            return self.client.node.heartbeat(params);
        })
        .then(function(res) {
            dbg.log0('heartbeat: res.version', res.version,
                'hb version', self.heartbeat_version,
                'node', self.node_name);

            if (res.version && self.heartbeat_version && self.heartbeat_version !== res.version) {
                dbg.log0('version changed, exiting');
                process.exit(0);
            }

            self.heartbeat_version = res.version;
            self.heartbeat_delay_ms = res.delay_ms;
            if (extended_hb) {
                self.extended_hb_last_time = Date.now();
            }

            if (res.ice_config) {
                self.n2n_agent.update_ice_config(res.ice_config);
            }

            var promises = [];

            if (res.auth_token) {
                dbg.log0('got node token', self.node_name);
                self.client.options.auth_token = res.auth_token;
                if (self.storage_path) {
                    var token_path = path.join(self.storage_path, 'token');
                    promises.push(fs.writeFileAsync(token_path, res.auth_token));
                }
            }

            if (self.rpc_address !== res.rpc_address) {
                dbg.log0('got rpc address', res.rpc_address,
                    'previously was', self.rpc_address);
                self.rpc_address = res.rpc_address;
                promises.push(self._start_stop_server());
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
                    self.store[0].agent_store.set_alloc(res.storage.alloc);
                }
            }

            return P.all(promises);
        })
        .fail(function(err) {

            dbg.error('HEARTBEAT FAILED', err, err.stack, 'node', self.node_name);

            // schedule delay to retry on error
            self.heartbeat_delay_ms = 30000 * (1 + Math.random());

        }).fin(function() {
            self._start_stop_heartbeats();
            self._start_stop_heartbeats();
        });
    //    }));
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
        self.heartbeat_timeout = setTimeout(self._do_heartbeat.bind(self), ms);
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
    dbg.log0('req etetet read_block:', req);
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
    dbg.log0('req etetet write_block:', self.store, ' with peer::::', req.rpc_params.node_peer_id);

    var block_md = req.rpc_params.block_md;
    var data = req.rpc_params.data;
    dbg.log1('write_block', block_md.id, data.length, 'node', self.node_name);
    return P.when(self.store[0].agent_store.write_block(block_md, data))
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
    dbg.log0('req etetet replicate:', req);

    // read from source agent
    return self.client.agent.read_block({
            block_md: source
        }, {
            address: source.address,
        })
        .then(function(res) {
            self.store_cache.invalidate(target);
            return self.store[0].agent_store.write_block(target, res.data);
        });
};

Agent.prototype.delete_blocks = function(req) {
    var self = this;
    var blocks = req.rpc_params.blocks;
    dbg.log0('delete_blocks', blocks, 'node', self.node_name);
    self.store_cache.multi_invalidate(blocks);
    return self.store[0].agent_store.delete_blocks(blocks);
};

Agent.prototype.kill_agent = function(req) {
    dbg.log0('kill requested, exiting');
    process.exit();
};

Agent.prototype.n2n_signal = function(req) {
    return this.rpc.n2n_signal(req.rpc_params);
};

Agent.prototype.self_test_io = function(req) {
    var self = this;
    var data = req.rpc_params.data;
    var req_len = data ? data.length : 0;
    var res_len = req.rpc_params.response_length;

    dbg.log0('SELF_TEST_IO',
        'req_len', req_len,
        'res_len', res_len,
        'source', req.rpc_params.source,
        'target', req.rpc_params.target);

    if (req.rpc_params.target !== self.rpc_address) {
        throw new Error('SELF_TEST_IO wrong address ' +
            req.rpc_params.target + ' mine is ' + self.rpc_address);
    }

    return {
        data: new Buffer(res_len)
    };
};

Agent.prototype.self_test_peer = function(req) {
    var self = this;
    var target = req.rpc_params.target;
    var source = req.rpc_params.source;
    var req_len = req.rpc_params.request_length;
    var res_len = req.rpc_params.response_length;

    dbg.log0('SELF_TEST_PEER',
        'req_len', req_len,
        'res_len', res_len,
        'source', source,
        'target', target);

    if (source !== self.rpc_address) {
        throw new Error('SELF_TEST_PEER wrong address ' +
            source + ' mine is ' + self.rpc_address);
    }

    // read/write from target agent
    return self.client.agent.self_test_io({
            source: source,
            target: target,
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
    return P.fcall(function() {
            return diag.collect_agent_diagnostics();
        })
        .then(function() {
            return diag.pack_diagnostics(inner_path);
        })
        .then(function() {
            dbg.log1('Reading packed file');
            return fs.readFileAsync(inner_path)
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
        return self.store[0].agent_store.corrupt_blocks(blocks);
    };

    Agent.prototype.list_blocks = function() {
        var self = this;
        dbg.log0('TEST API list_blocks');
        return self.store[0].agent_store.list_blocks();
    };
};
