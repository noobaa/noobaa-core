/**
 *
 * AGENT
 *
 * the glorious noobaa agent.
 *
 */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const assert = require('assert');
const crypto = require('crypto');
const express = require('express');
const ip_module = require('ip');
const express_compress = require('compression');
const express_body_parser = require('body-parser');
const express_morgan_logger = require('morgan');
const express_method_override = require('method-override');

const P = require('../util/promise');
const pem = require('../util/pem');
const api = require('../api');
const pkg = require('../../package.json');
const dbg = require('../util/debug_module')(__filename);
const diag = require('./agent_diagnostics');
const config = require('../../config.js');
const os_utils = require('../util/os_utils');
const js_utils = require('../util/js_utils');
const url_utils = require('../util/url_utils');
const size_utils = require('../util/size_utils');
const time_utils = require('../util/time_utils');
const BlockStoreFs = require('./block_store_fs').BlockStoreFs;
const BlockStoreS3 = require('./block_store_s3').BlockStoreS3;
const BlockStoreMem = require('./block_store_mem').BlockStoreMem;
const promise_utils = require('../util/promise_utils');


class Agent {

    constructor(params) {
        dbg.log0('process.env.DEBUG_MODE=' + process.env.DEBUG_MODE);

        this.rpc = api.new_rpc(params.address);
        this.client = this.rpc.new_client();

        this.rpc.on('reconnect', conn => this._on_rpc_reconnect(conn));
        assert(params.node_name, 'missing param: node_name');
        this.node_name = params.node_name;
        this.token = params.token;
        this.storage_path = params.storage_path;
        if (params.storage_limit) {
            this.storage_limit = params.storage_limit;
        }

        this.is_internal_agent = params.is_internal_agent;

        const block_store_options = {
            node_name: this.node_name,
            rpc_client: this.client,
            storage_limit: params.storage_limit,
        };
        if (this.storage_path) {
            assert(!this.token, 'unexpected param: token. ' +
                'with storage_path the token is expected in the file <storage_path>/token');
            if (params.cloud_info) {
                this.cloud_info = params.cloud_info;
                block_store_options.cloud_info = params.cloud_info;
                this.block_store = new BlockStoreS3(block_store_options);
            } else {
                block_store_options.root_path = this.storage_path;
                this.block_store = new BlockStoreFs(block_store_options);
            }
        } else {
            assert(this.token, 'missing param: token. ' +
                'without storage_path the token must be provided as agent param');
            this.block_store = new BlockStoreMem(block_store_options);
        }

        this.agent_app = (() => {
            const app = express();
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

        // AGENT API methods - bind to self
        // (rpc registration requires bound functions)
        js_utils.self_bind(this, [
            'get_agent_info',
            'update_auth_token',
            'update_rpc_address',
            'update_base_address',
            'update_n2n_config',
            'n2n_signal',
            'test_disk_write',
            'test_disk_read',
            'test_network_io',
            'test_network_to_peer',
            'collect_diagnostics',
            'set_debug_node',
        ]);

        // register rpc to serve the apis
        this.rpc.register_service(
            this.rpc.schema.agent_api,
            this, {
                // verify every agent_api request is on the server connection only
                middleware: [req => this._verify_server_connection(req)]
            });
        this.rpc.register_service(
            this.rpc.schema.block_store_api,
            this.block_store, {
                // TODO verify requests for block store?
                // middleware: [ ... ]
            });
        // register rpc http server
        this.rpc.register_http_transport(this.agent_app);
        // register rpc n2n
        this.n2n_agent = this.rpc.register_n2n_transport(this.client.node.n2n_signal);

        // TODO these sample geolocations are just for testing
        this.geolocation = _.sample([
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
    }

    start() {
        this.is_started = true;
        this.rpc.set_disconnected_state(false);

        return P.resolve()
            .then(() => this._init_node())
            .then(() => this._do_heartbeat())
            .catch(err => {
                dbg.error('server failed to start', err.stack || err);
                this.stop();
                throw err;
            });
    }

    stop() {
        dbg.log0('stop agent ' + this.node_name);
        this.is_started = false;
        // mark the rpc state as disconnected to close and reject incoming connections
        this.rpc.set_disconnected_state(true);
        this._start_stop_server();
        // reset the n2n config to close any open ports
        this.n2n_agent.update_n2n_config({
            tcp_permanent_passive: false
        });
    }

    _init_node() {
        return P.resolve()
            .then(() => {
                if (this.storage_path) {
                    return os_utils.get_mount_of_path(this.storage_path);
                }
            })
            .then(storage_path_mount => {
                this.storage_path_mount = storage_path_mount;

                // if not using storage_path, a token should be provided
                if (!this.storage_path) return this.token;

                // load the token file
                const token_path = path.join(this.storage_path, 'token');
                return fs.readFileAsync(token_path);
            })
            .then(token => {
                // use the token as authorization (either 'create_node' or 'agent' role)
                this.client.options.auth_token = token.toString();
                return P.nfcall(pem.createCertificate, {
                    days: 365 * 100,
                    selfSigned: true
                });
            })
            .then(pem_cert => {
                this.ssl_cert = {
                    key: pem_cert.serviceKey,
                    cert: pem_cert.certificate
                };
                // update the n2n ssl to use my certificate
                this.n2n_agent.set_ssl_context(this.ssl_cert);
            });
    }

    _do_heartbeat() {
        if (!this.is_started) return;

        return this.client.node.heartbeat({
                version: pkg.version
            }, {
                return_rpc_req: true
            }).then(req => {
                const res = req.reply;
                const conn = req.connection;
                this._server_connection = conn;
                if (res.version !== pkg.version) {
                    dbg.warn('exit no version change:',
                        'res.version', res.version,
                        'pkg.version', pkg.version);
                    process.exit(0);
                }
                conn.on('close', () => {
                    if (this._server_connection === conn) {
                        this._server_connection = null;
                    }
                    P.delay(1000).then(() => this._do_heartbeat());
                });
            })
            .catch(err => {
                dbg.error('heartbeat failed', err);
                return P.delay(1000).then(() => this._do_heartbeat());
            });
    }

    _start_stop_server() {

        // in any case we stop
        this.n2n_agent.reset_rpc_address();
        if (this.server) {
            this.server.close();
            this.server = null;
        }

        if (!this.is_started) return;
        if (!this.rpc_address) return;

        const retry = () => {
            if (this.is_started) {
                setTimeout(() => this._start_stop_server(), 1000);
            }
        };

        const addr_url = url_utils.quick_parse(this.rpc_address);
        if (addr_url.protocol === 'n2n:') {
            this.n2n_agent.set_rpc_address(addr_url.href);
        } else if (addr_url.protocol === 'ws:' || addr_url.protocol === 'http:') {
            const http_server = http.createServer(this.agent_app)
                .on('error', err => {
                    dbg.error('AGENT HTTP SERVER ERROR', err.stack || err);
                    http_server.close();
                })
                .on('close', () => {
                    dbg.warn('AGENT HTTP SERVER CLOSED');
                    retry();
                })
                .listen(addr_url.port);
            if (addr_url.protocol === 'ws:') {
                this.rpc.register_ws_transport(http_server);
            }
            this.server = http_server;
        } else if (addr_url.protocol === 'wss:' || addr_url.protocol === 'https:') {
            const https_server = https.createServer(this.ssl_cert, this.agent_app)
                .on('error', err => {
                    dbg.error('AGENT HTTPS SERVER ERROR', err.stack || err);
                    https_server.close();
                })
                .on('close', () => {
                    dbg.warn('AGENT HTTPS SERVER CLOSED');
                    retry();
                })
                .listen(addr_url.port);
            if (addr_url.protocol === 'wss:') {
                this.rpc.register_ws_transport(https_server);
            }
            this.server = https_server;
        } else if (addr_url.protocol === 'tcp:') {
            const tcp_server = this.rpc.register_tcp_transport(addr_url.port);
            tcp_server.on('close', () => {
                dbg.warn('AGENT TCP SERVER CLOSED');
                retry();
            });
            this.server = tcp_server;
        } else if (addr_url.protocol === 'tls:') {
            const tls_server = this.rpc.register_tcp_transport(addr_url.port, this.ssl_cert);
            tls_server.on('close', () => {
                dbg.warn('AGENT TLS SERVER CLOSED');
                retry();
            });
            this.server = tls_server;
        } else {
            dbg.error('UNSUPPORTED AGENT PROTOCOL', addr_url);
        }
    }

    _verify_server_connection(req) {
        if (req.connection !== this._server_connection) {
            dbg.error('AGENT API requests only allowed from server',
                req.connection && req.connection.connid,
                this._server_connection && this._server_connection.connid);
            throw req.rpc_error('FORBIDDEN', 'AGENT API requests only allowed from server');
        }
    }


    // AGENT API //////////////////////////////////////////////////////////////////


    get_agent_info(req) {
        const extended_hb = true;
        const ip = ip_module.address();
        const reply = {
            version: pkg.version || '',
            name: this.node_name || '',
            ip: ip,
            rpc_address: this.rpc_address || '',
            base_address: this.rpc.router.default,
            geolocation: this.geolocation,
            is_internal_agent: this.is_internal_agent,
            debug_level: dbg.get_module_level('core'),
        };
        if (this.cloud_info && this.cloud_info.cloud_pool_name) {
            reply.cloud_pool_name = this.cloud_info.cloud_pool_name;
        }
        if (extended_hb) {
            reply.os_info = os_utils.os_info();
        }

        return P.resolve()
            .then(() => this.block_store.get_storage_info())
            .then(storage_info => {
                dbg.log0('storage_info:', storage_info);
                reply.storage = storage_info;
            })
            .then(() => extended_hb && os_utils.read_drives()
                .catch(err => {
                    dbg.error('read_drives: ERROR', err.stack || err);
                }))
            .then(drives => {
                if (!drives) return;
                // for now we only use a single drive,
                // so mark the usage on the drive of our storage folder.
                const used_size = reply.storage.used;
                const used_drives = _.filter(drives, drive => {
                    dbg.log0('used drives:', this.storage_path_mount, drive, used_size);
                    //if there is no this.storage_path_mount, it's a memory agent for testing.
                    if (this.storage_path_mount === drive.mount || !this.storage_path_mount) {
                        drive.storage.used = used_size;
                        if (this.storage_limit) {
                            drive.storage.limit = this.storage_limit;
                            let limited_total = this.storage_limit;
                            let limited_free = limited_total - used_size;
                            drive.storage.total = Math.min(limited_total, drive.storage.total);
                            drive.storage.free = Math.min(limited_free, drive.storage.free);
                        }
                        return true;
                    } else {
                        return false;
                    }
                });
                reply.drives = used_drives;
                dbg.log0('DRIVES:', drives, 'used drives', used_drives);
                // _.each(drives, drive => {
                //     if (this.storage_path_mount === drive.mount) {
                //         drive.storage.used = used_size;
                //     }
                // });
            })
            .return(reply);
    }

    update_auth_token(req) {
        const auth_token = req.rpc_params.auth_token;
        return P.resolve()
            .then(() => {
                if (this.storage_path) {
                    const token_path = path.join(this.storage_path, 'token');
                    return fs.writeFileAsync(token_path, auth_token);
                }
            })
            .then(() => {
                this.client.options.auth_token = auth_token;
            });
    }

    update_rpc_address(req) {
        const rpc_address = req.rpc_params.rpc_address;
        const prev_rpc_address = this.rpc_address;
        dbg.log0('update_rpc_address to', rpc_address,
            'was', prev_rpc_address);
        this.rpc_address = rpc_address;
        return this._start_stop_server();
    }

    update_base_address(req) {
        const base_address = req.rpc_params.base_address;
        const existing_base_address = this.rpc.router.default;
        dbg.log0('update_base_address: to -', base_address, 'was -', existing_base_address);
        return P.resolve()
            .then(() => this.client.node.ping(null, {
                // test this new address first by pinging it
                address: base_address
            }))
            .then(() => P.nfcall(fs.readFile, 'agent_conf.json')
                .then(data => {
                    const agent_conf = JSON.parse(data);
                    dbg.log0('update_base_address: old address in agent_conf.json was -', agent_conf.address);
                    return agent_conf;
                }, err => {
                    if (err.code === 'ENOENT') {
                        dbg.log0('update_base_address: no agent_conf.json file. creating new one...');
                        return {};
                    } else {
                        throw err;
                    }
                }))
            .then(agent_conf => {
                agent_conf.address = base_address;
                const data = JSON.stringify(agent_conf);
                return P.nfcall(fs.writeFile, 'agent_conf.json', data);
            })
            .then(() => {
                dbg.log0('update_base_address: done -', base_address);
                this.rpc.router = api.new_router(base_address);
                // this.rpc.disconnect_all();
                this._do_heartbeat();
            });
    }

    update_n2n_config(req) {
        console.log('AGENT GOT UPDATE N2N CONFIG', req.rpc_params);
        const n2n_config = req.rpc_params;
        this.n2n_agent.update_n2n_config(n2n_config);
    }

    n2n_signal(req) {
        return this.rpc.accept_n2n_signal(req.rpc_params);
    }

    test_disk_read() {
        const data = crypto.randomBytes(1024);
        const block_md = {
            id: '_test_latency_of_disk_read',
            digest_type: 'sha1'
        };
        block_md.digest_b64 = crypto.createHash(block_md.digest_type).update(data).digest('base64');
        return this.block_store.write_block(block_md, data)
            .then(() => {
                return test_average_latency(() => this.block_store.read_block(block_md));
            });
    }

    test_disk_write() {
        return test_average_latency(() => {
            const data = crypto.randomBytes(1024);
            const block_md = {
                id: '_test_latency_of_disk_write',
                digest_type: 'sha1'
            };
            block_md.digest_b64 = crypto.createHash(block_md.digest_type).update(data).digest('base64');
            return this.block_store.write_block(block_md, data);
        });
    }

    test_network_io(req) {
        const data = req.rpc_params.data;
        const req_len = data ? data.length : 0;
        const res_len = req.rpc_params.response_length;

        dbg.log1('test_network_io:',
            'req_len', req_len,
            'res_len', res_len,
            'source', req.rpc_params.source,
            'target', req.rpc_params.target);

        if (req.rpc_params.target !== this.rpc_address) {
            throw new Error('test_network_io: wrong address ' +
                req.rpc_params.target + ' mine is ' + this.rpc_address);
        }

        return {
            data: new Buffer(res_len)
        };
    }

    test_network_to_peer(req) {
        const target = req.rpc_params.target;
        const source = req.rpc_params.source;
        const req_len = req.rpc_params.request_length;
        const res_len = req.rpc_params.response_length;
        const concur = req.rpc_params.concur;
        let count = req.rpc_params.count;

        dbg.log0('test_network_to_peer:',
            'source', source,
            'target', target,
            'req_len', req_len,
            'res_len', res_len,
            'count', count,
            'concur', concur);

        if (source !== this.rpc_address) {
            throw new Error('test_network_to_peer: wrong address ' +
                source + ' mine is ' + this.rpc_address);
        }
        const reply = {};

        const next = () => {
            if (count <= 0) return;
            count -= 1;
            // read/write from target agent
            return this.client.agent.test_network_io({
                    source: source,
                    target: target,
                    data: new Buffer(req_len),
                    response_length: res_len,
                }, {
                    address: target,
                    return_rpc_req: true // we want to check req.connection
                })
                .then(io_req => {
                    const data = io_req.reply.data;
                    if (((!data || !data.length) && res_len > 0) ||
                        (data && data.length && data.length !== res_len)) {
                        throw new Error('test_network_to_peer: response_length mismatch');
                    }
                    const session = io_req.connection.session;
                    reply.session = session && session.key;
                    return next();
                });
        };

        return P.all(_.times(concur, next)).return(reply);
    }

    collect_diagnostics(req) {
        dbg.log1('Recieved diag req', req);
        const is_windows = (process.platform === "win32");
        const inner_path = is_windows ? process.env.ProgramData + '/agent_diag.tgz' : '/tmp/agent_diag.tgz';

        return P.resolve()
            .then(() => diag.collect_agent_diagnostics())
            .then(() => diag.pack_diagnostics(inner_path))
            .catch(err => {
                dbg.error('DIAGNOSTICS COLLECTION FAILED', err.stack || err);
                throw new Error('Agent Collect Diag Error on collecting diagnostics');
            })
            .then(() => {
                dbg.log1('Reading packed file');
                return fs.readFileAsync(inner_path)
                    .then(data => ({
                        data: new Buffer(data),
                    }))
                    .catch(err => {
                        dbg.error('DIAGNOSTICS READ FAILED', err.stack || err);
                        throw new Error('Agent Collect Diag Error on reading packges diag file');
                    });
            })
            .catch(err => {
                dbg.error('DIAGNOSTICS FAILED', err.stack || err);
                return {
                    data: new Buffer(),
                };
            });
    }

    set_debug_node(req) {
        dbg.set_level(req.rpc_params.level, 'core');
        dbg.log1('Recieved set debug req ', req.rpc_params.level);
        if (req.rpc_params.level > 0) { //If level was set, unset it after a T/O
            promise_utils.delay_unblocking(10 * 60 * 1000) // 10 minutes
                .then(() => {
                    dbg.set_level(0, 'core');
                });
        }
    }

}


function test_average_latency(func) {
    const results = [];
    return promise_utils.loop(6, () => {
            const start = time_utils.millistamp();
            return P.fcall(func).then(() => {
                results.push(time_utils.millistamp() - start);
                // use some jitter delay to avoid serializing on cpu when
                // multiple tests are run together.
                return P.delay(200 * (0.5 + Math.random()));
            });
        })
        .then(() => {
            // throw the first result which is sometimes skewed
            return results.slice(1);
        });
}


module.exports = Agent;
