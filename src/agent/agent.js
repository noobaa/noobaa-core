/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const assert = require('assert');
const ip_module = require('ip');
const child_process = require('child_process');
const os = require('os');
const util = require('util');

const P = require('../util/promise');
const api = require('../api');
const pkg = require('../../package.json');
const DebugLogger = require('../util/debug_module');
const diag = require('./agent_diagnostics');
const config = require('../../config');
const FuncNode = require('./func_services/func_node');
const os_utils = require('../util/os_utils');
const js_utils = require('../util/js_utils');
const net_utils = require('../util/net_utils');
const url_utils = require('../util/url_utils');
const ssl_utils = require('../util/ssl_utils');
const time_utils = require('../util/time_utils');
const json_utils = require('../util/json_utils');
const cloud_utils = require('../util/cloud_utils');
const promise_utils = require('../util/promise_utils');
const BlockStoreFs = require('./block_store_services/block_store_fs').BlockStoreFs;
const BlockStoreS3 = require('./block_store_services/block_store_s3').BlockStoreS3;
const BlockStoreGoogle = require('./block_store_services/block_store_google').BlockStoreGoogle;
const BlockStoreMongo = require('./block_store_services/block_store_mongo').BlockStoreMongo;
const BlockStoreMem = require('./block_store_services/block_store_mem').BlockStoreMem;
const BlockStoreAzure = require('./block_store_services/block_store_azure').BlockStoreAzure;



const { RpcError, RPC_BUFFERS } = require('../rpc');

const TEST_CONNECTION_TIMEOUT_DELAY = 2 * 60 * 1000; // test connection 2 ninutes after nodes_monitor stopped communicating
const MASTER_RESPONSE_TIMEOUT = 30 * 1000; // 30 timeout for master to respond to HB
const MASTER_MAX_CONNECT_ATTEMPTS = 20;


class Agent {

    /* eslint-disable max-statements */
    constructor(params) {
        // We set the agent name to dbg logger
        this.dbg = new DebugLogger(__filename);
        this.dbg.set_logger_name('Agent.' + params.node_name);
        const dbg = this.dbg;
        dbg.log0('Creating agent', params);

        this.rpc = api.new_rpc(params.address);
        this.client = this.rpc.new_client();

        this.servers = params.servers || [{
            address: params.address
        }];

        this.cpu_usage = process.cpuUsage();
        this.cpu_usage.time_stamp = time_utils.microstamp();

        this.base_address = params.address ? params.address.toLowerCase() : this.rpc.router.default;
        this.master_address = this.base_address;
        this.proxy = params.proxy;
        dbg.log0(`this.base_address=${this.base_address}`);
        dbg.log0(`this.master_address=${this.base_address}`);
        this.host_id = params.host_id;
        this.location_info = params.location_info;
        this.test_hostname = params.test_hostname;
        this.host_name = os.hostname();

        this.agent_conf = params.agent_conf || new json_utils.JsonObjectWrapper();

        this.connect_attempts = 0;
        this._test_connection_timeout = null;
        this.permission_tempering = params.permission_tempering;

        assert(params.node_name, 'missing param: node_name');
        this.node_name = params.node_name;
        this.token = params.token;
        this.token_wrapper = params.token_wrapper;
        this.create_node_token_wrapper = params.create_node_token_wrapper;

        this.enabled = false;

        this.storage_path = params.storage_path;
        this.storage_limit = params.storage_limit;

        const block_store_options = {
            node_name: this.node_name,
            rpc_client: this.client,
            storage_limit: this.storage_limit,
            proxy: this.proxy
        };
        if (this.storage_path) {
            assert(!this.token, 'unexpected param: token. ' +
                'with storage_path the token is expected in the file <storage_path>/token');
            if (params.s3_agent) {
                this.node_type = 'ENDPOINT_S3';
                dbg.log0(`this is a S3 agent`);
                // TODO: currently ports are hard coded and not used anywhere.
                this.endpoint_info = {
                    stats: this._get_zeroed_stats_object()
                };
            } else if (params.cloud_info) {
                this.cloud_info = params.cloud_info;
                block_store_options.cloud_info = params.cloud_info;
                block_store_options.cloud_path = params.cloud_path;
                if (params.cloud_info.endpoint_type === 'AWS' ||
                    params.cloud_info.endpoint_type === 'S3_COMPATIBLE' ||
                    params.cloud_info.endpoint_type === 'FLASHBLADE') {
                    this.node_type = 'BLOCK_STORE_S3';
                    this.block_store = new BlockStoreS3(block_store_options);
                } else if (params.cloud_info.endpoint_type === 'AZURE') {
                    let connection_string = cloud_utils.get_azure_connection_string({
                        endpoint: params.cloud_info.endpoint,
                        access_key: params.cloud_info.access_keys.access_key,
                        secret_key: params.cloud_info.access_keys.secret_key
                    });
                    block_store_options.cloud_info.azure = {
                        connection_string: connection_string,
                        container: params.cloud_info.target_bucket
                    };
                    this.node_type = 'BLOCK_STORE_AZURE';
                    this.block_store = new BlockStoreAzure(block_store_options);
                } else if (params.cloud_info.endpoint_type === 'GOOGLE') {
                    this.node_type = 'BLOCK_STORE_GOOGLE';
                    const { project_id, private_key, client_email } = JSON.parse(params.cloud_info.access_keys.secret_key);
                    block_store_options.cloud_info.google = { project_id, private_key, client_email };
                    this.block_store = new BlockStoreGoogle(block_store_options);
                }
            } else if (params.mongo_info) {
                this.mongo_info = params.mongo_info;
                block_store_options.mongo_path = params.mongo_path;
                this.node_type = 'BLOCK_STORE_MONGO';
                this.block_store = new BlockStoreMongo(block_store_options);
            } else {
                block_store_options.root_path = this.storage_path;
                this.node_type = 'BLOCK_STORE_FS';
                this.block_store = new BlockStoreFs(block_store_options);
            }
        } else {
            assert(this.token, 'missing param: token. ' +
                'without storage_path the token must be provided as agent param');
            this.node_type = 'BLOCK_STORE_FS';
            this.block_store = new BlockStoreMem(block_store_options);
        }

        this.func_node = new FuncNode({
            rpc_client: this.client,
            storage_path: this.storage_path,
        });

        // AGENT API methods - bind to self
        // (rpc registration requires bound functions)
        js_utils.self_bind(this, [
            'get_agent_info_and_update_masters',
            'get_agent_storage_info',
            'update_auth_token',
            'update_create_node_token',
            'update_rpc_config',
            'n2n_signal',
            'test_store_perf',
            'test_network_perf',
            'test_network_perf_to_peer',
            'collect_diagnostics',
            'set_debug_node',
            'update_s3rver',
            'decommission',
            'recommission',
            'uninstall',
            'update_node_service'
        ]);

        // register rpc to serve the apis
        this.rpc.register_service(
            this.rpc.schema.agent_api,
            this, {
                middleware: [req => this._authenticate_agent_api(req)]
            }
        );
        if (this.block_store) {
            this.rpc.register_service(
                this.rpc.schema.block_store_api,
                this.block_store, {
                    // TODO verify requests for block store?
                    // middleware: [ ... ]
                }
            );
        }
        this.rpc.register_service(
            this.rpc.schema.func_node_api,
            this.func_node, {
                // TODO verify requests for block store?
                // middleware: [ ... ]
            }
        );

        // register rpc n2n
        this.n2n_agent = this.rpc.register_n2n_agent(this.client.node.n2n_signal);

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
        const dbg = this.dbg;
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

    stop(force_close_n2n) {
        const dbg = this.dbg;
        dbg.log0('stop agent ' + this.node_name);
        this.is_started = false;
        // mark the rpc state as disconnected to close and reject incoming connections
        this.rpc.set_disconnected_state(true);
        this.rpc_address = '';
        clearTimeout(this._test_connection_timeout);
        if (this._server_connection) this._server_connection.close();
        this._start_stop_server();

        if (force_close_n2n === 'force_close_n2n') {
            // TODO: for now commented out the update_n2n_config. revisit if needed (issue #2379)
            // reset the n2n config to close any open ports
            this.n2n_agent.disconnect();
        }
    }

    sample_stats() {
        if (this.block_store) {
            return this.block_store.sample_stats();
        }
    }

    _update_servers_list(new_list) {
        // check if base_address appears in new_list. if not add it.
        if (_.isUndefined(new_list.find(srv => srv.address.toLowerCase() === this.base_address.toLowerCase()))) {
            new_list.push({
                address: this.base_address
            });
        }
        let sorted_new = _.sortBy(new_list, srv => srv.address);
        let sorted_old = _.sortBy(this.servers, srv => srv.address);
        if (_.isEqual(sorted_new, sorted_old)) return P.resolve();
        this.servers = new_list;
        return this.agent_conf.update({
            servers: this.servers
        });
    }

    _handle_server_change(suggested) {
        const dbg = this.dbg;
        dbg.warn('_handle_server_change',
            suggested ?
            'suggested server ' + suggested :
            'no suggested server, trying next in list',
            this.servers);
        this.connect_attempts = 0;
        if (!this.servers.length) {
            dbg.error('_handle_server_change no server list');
            return P.resolve();
        }
        const previous_address = this.rpc.router.default;
        dbg.log0('previous_address =', previous_address);
        dbg.log0('original servers list =', util.inspect(this.servers));
        if (suggested) {
            //Find if the suggested server appears in the list we got from the initial connect
            const current_server = _.remove(this.servers, srv => srv.address === suggested);
            if (current_server[0]) {
                this.servers.unshift(current_server[0]);
            }
        } else {
            //Skip to the next server in list
            this.servers.push(this.servers.shift());
        }
        const new_address = suggested ? suggested : this.servers[0].address;
        dbg.log0('new servers list =', util.inspect(this.servers));
        dbg.log0('Chosen new address', new_address);
        return this._update_rpc_config_internal({
            master_address: new_address,
            old_master_address: previous_address,
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
                return this.token_wrapper.read();

            })
            .then(token => {
                // use the token as authorization (either 'create_node' or 'agent' role)
                this.client.options.auth_token = token.toString();
                this.ssl_context = ssl_utils.generate_ssl_certificate();
                // update the n2n ssl to use my certificate
                this.n2n_agent.set_ssl_context(this.ssl_context);
            })
            .then(() => {
                if (this.block_store) {
                    return this.block_store.init();
                }
            });
    }


    async _do_heartbeat() {
        const dbg = this.dbg;
        let done = false;
        while (!done) {
            try {
                if (!this.is_started) return;
                const hb_info = {
                    version: pkg.version
                };
                if (this.cloud_info) {
                    hb_info.pool_name = this.cloud_info.pool_name;
                } else if (this.mongo_info) {
                    hb_info.pool_name = this.mongo_info.pool_name;
                }

                dbg.log0(`_do_heartbeat called. sending HB to ${this.master_address}`);

                if (this.connect_attempts > MASTER_MAX_CONNECT_ATTEMPTS) {
                    dbg.error('too many failure to connect, switching servers');
                    await this._handle_server_change();
                    throw new Error('server change after too many attempts');
                }

                const req = await this.client.node.heartbeat(hb_info, {
                    return_rpc_req: true,
                    timeout: MASTER_RESPONSE_TIMEOUT,
                });

                dbg.log0('heartbeat successful. connected to server. got reply', req.reply);

                const res = req.reply;
                if (res.redirect) {
                    dbg.log0('got redirect response:', res.redirect);
                    await this._handle_server_change(res.redirect);
                    throw new Error('redirect to ' + res.redirect);
                }

                if (res.version !== pkg.version) {
                    dbg.warn('identified version change:',
                        'res.version', res.version,
                        'pkg.version', pkg.version);
                    this.send_message_and_exit('UPGRADE', 0);
                }

                const conn = req.connection;
                this._server_connection = conn;
                this.connect_attempts = 0;

                if (conn._agent_heartbeat_close_listener) {
                    conn.off('close', conn._agent_heartbeat_close_listener);
                    conn._agent_heartbeat_close_listener = null;
                }
                const listener = async () => {
                    if (this._server_connection === conn) {
                        this._server_connection = null;
                    }
                    if (!this.is_started) return;
                    await P.delay(1000);
                    await this._do_heartbeat();
                };
                conn._agent_heartbeat_close_listener = listener;
                conn.on('close', listener);

                done = true;

            } catch (err) {

                dbg.error('heartbeat failed', err.stack || err.message);

                if (err.rpc_code === 'DUPLICATE') {
                    dbg.error('This agent appears to be duplicated.',
                        'exiting and starting new agent', err);
                    if (this.cloud_info || this.mongo_info) {
                        dbg.error(`shouldnt be here. found duplicated node for cloud pool or mongo pool!!`);
                        throw new Error('found duplicated cloud or mongo node');
                    } else {
                        this.send_message_and_exit('DUPLICATE', 68); // 68 is 'D' in ascii
                    }
                }

                if (err.rpc_code === 'NODE_NOT_FOUND') {
                    dbg.error('This agent appears to be using an old token.',
                        'cleaning this agent noobaa_storage directory', this.storage_path);
                    if (this.cloud_info || this.mongo_info) {
                        dbg.error(`shouldnt be here. node not found for cloud pool or mongo pool!!`);
                        throw new Error('node not found cloud or mongo node');
                    } else {
                        this.send_message_and_exit('NOTFOUND', 69); // 69 is 'E' in ascii
                    }
                }

                this.connect_attempts += 1;
                await P.delay(3000);
            }
        }
    }

    _start_stop_server() {
        const dbg = this.dbg;

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
            const http_server = http.createServer()
                .on('error', err => {
                    dbg.error('AGENT HTTP SERVER ERROR', err.stack || err);
                    http_server.close();
                })
                .on('close', () => {
                    dbg.warn('AGENT HTTP SERVER CLOSED');
                    retry();
                })
                .listen(addr_url.port);
            this.rpc.register_http_transport(http_server);
            if (addr_url.protocol === 'ws:') {
                this.rpc.register_ws_transport(http_server);
            }
            this.server = http_server;
        } else if (addr_url.protocol === 'wss:' || addr_url.protocol === 'https:') {
            const https_server = https.createServer(this.ssl_context)
                .on('error', err => {
                    dbg.error('AGENT HTTPS SERVER ERROR', err.stack || err);
                    https_server.close();
                })
                .on('close', () => {
                    dbg.warn('AGENT HTTPS SERVER CLOSED');
                    retry();
                })
                .listen(addr_url.port);
            this.rpc.register_http_transport(https_server);
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
            const tls_server = this.rpc.register_tcp_transport(addr_url.port, this.ssl_context);
            tls_server.on('close', () => {
                dbg.warn('AGENT TLS SERVER CLOSED');
                retry();
            });
            this.server = tls_server;
        } else {
            dbg.error('UNSUPPORTED AGENT PROTOCOL', addr_url);
        }
    }

    _authenticate_agent_api(req) {
        const dbg = this.dbg;

        // agent_api request on the server connection are always allowed
        if (req.connection === this._server_connection) return;

        const auth = req.method_api.auth;
        if (!auth || !auth.n2n) {
            dbg.error('AGENT API requests only allowed from server',
                req.connection && req.connection.connid,
                this._server_connection && this._server_connection.connid);
            // close the connection but after sending the error response, for supportability of the caller
            setTimeout(() => req.connection.close(), 1000);
            throw new RpcError('FORBIDDEN', 'AGENT API requests only allowed from server');
        }

        if (req.connection.url.protocol !== 'n2n:') {
            dbg.error('AGENT API auth requires n2n connection',
                req.connection && req.connection.connid);
            // close the connection but after sending the error response, for supportability of the caller
            setTimeout(() => req.connection.close(), 1000);
            throw new RpcError('FORBIDDEN', 'AGENT API auth requires n2n connection');
        }
        // otherwise it's good
    }

    async _update_rpc_config_internal(params) {
        const dbg = this.dbg;

        if (params.n2n_config) {
            this.n2n_agent.update_n2n_config(params.n2n_config);
        }

        if (params.rpc_address && params.rpc_address !== params.old_rpc_address) {
            dbg.log0('new rpc_address', params.rpc_address,
                'old', params.old_rpc_address);
            this.rpc_address = params.rpc_address;
            this._start_stop_server();
        }

        if (params.base_address && params.base_address.toLowerCase() !== this.base_address.toLowerCase()) {
            dbg.log0('new base_address', params.base_address,
                'old', params.old_base_address);
            // test this new address first by pinging it
            try {
                await this.client.node.ping(null, {
                        address: params.base_address
                    })
                    .timeout(MASTER_RESPONSE_TIMEOUT);
            } catch (err) {
                dbg.error(`failed ping to new base_address ${params.base_address}. leave base_address at ${this.base_address}`);
                throw new Error(`failed ping to new base_address ${params.base_address}`);
            }
            // change both master and base addresses
            this.master_address = params.base_address.toLowerCase();
            this.base_address = params.base_address.toLowerCase();
            await this.agent_conf.update({
                address: this.base_address
            });
            // update rpc_router
            this.update_rpc_router(this.base_address);
        }

        if (params.master_address) {
            const { old_master_address = this.master_address } = params;
            if (params.master_address !== old_master_address) {
                try {
                    await this.client.node.ping(null, {
                            address: params.master_address
                        })
                        .timeout(MASTER_RESPONSE_TIMEOUT);
                } catch (err) {
                    dbg.error(`failed ping to new master_address ${params.master_address}.`,
                        `leave master_address at ${this.master_address}`);
                    throw new Error(`failed ping to new master_address ${params.master_address}`);
                }
                this.master_address = params.master_address;
            }

            // update rpc_router
            this.update_rpc_router(params.master_address);
        }
    }

    update_rpc_router(address) {
        const dbg = this.dbg;

        dbg.log0('update_rpc_router: updating address to', address);
        this.rpc.router = api.new_router(address);
        if (this.endpoint_info && this.endpoint_info.s3rver_process) {
            this._disable_service();
            this._enable_service();
        }
        // on close the agent should call do_heartbeat again when getting the close event
        if (this._server_connection) {
            this._server_connection.close();
        }
    }

    _fix_storage_limit(storage_info) {
        if (this.storage_limit) {
            storage_info.limit = this.storage_limit;
        }
    }

    _test_server_connection() {
        const dbg = this.dbg;
        clearTimeout(this._test_connection_timeout);

        this._test_connection_timeout = setTimeout(() => {
            this.client.node.ping()
                .timeout(MASTER_RESPONSE_TIMEOUT)
                .then(() => {
                    this._test_connection_timeout = null;
                })
                .catch(P.TimeoutError, err => {
                    dbg.error('node_server did not respond to ping. closing connection', err);
                    this._server_connection.close();
                    this._test_connection_timeout = null;
                })
                .catch(err => {
                    dbg.error('Ping to server returned error:', err);
                    this._server_connection.close();
                    this._test_connection_timeout = null;
                });
        }, TEST_CONNECTION_TIMEOUT_DELAY).unref();
    }

    // AGENT API //////////////////////////////////////////////////////////////////

    update_node_service(req) {
        this.location_info = req.rpc_params.location_info;
        if (req.rpc_params.enabled) {
            this._ssl_certs = req.rpc_params.ssl_certs;
            return this._enable_service();
        } else {
            return this._disable_service();
        }
    }

    _get_zeroed_stats_object() {
        return {
            read_count: 0,
            read_bytes: 0,
            write_count: 0,
            write_bytes: 0
        };
    }

    _disable_service() {
        const dbg = this.dbg;
        dbg.log0(`got _disable_service`);
        this.enabled = false;
        if (this.endpoint_info) {
            if (!this.endpoint_info.s3rver_process) return;
            // should we use a different signal?
            this.endpoint_info.s3rver_process.kill('SIGTERM');
            this.endpoint_info.s3rver_process = null;
        } else {
            dbg.warn('got _disable_service on storage agent');
        }
    }


    _enable_service() {
        const dbg = this.dbg;
        this.enabled = true;
        if (this.endpoint_info) {
            dbg.log0(`got _enable_service`, this.endpoint_info);
            try {
                if (this.endpoint_info.s3rver_process) {
                    dbg.warn('S3 server already started. process:', this.endpoint_info.s3rver_process);
                    this.endpoint_info.s3rver_process.send({
                        message: 'location_info',
                        location_info: this.location_info,
                    });
                    return;
                }

                // run node process, inherit stdio and connect ipc channel for communication.
                const s3rver_args = ['--s3_agent', '--address', this.master_address];
                dbg.log0('starting s3 server with command: node ./src/s3/s3rver_starter', s3rver_args.join(' '));
                this.endpoint_info.s3rver_process = child_process.fork('./src/s3/s3rver_starter', s3rver_args, {
                        stdio: ['inherit', 'inherit', 'inherit', 'ipc']
                    })
                    .on('message', this._handle_s3rver_messages.bind(this))
                    .on('error', err => {
                        dbg.error('got error from s3rver:', err);
                        this.endpoint_info.error_event = err;
                    })
                    .once('exit', (code, signal) => {
                        const RETRY_PERIOD = 30000;
                        dbg.warn(`s3rver process exited with code=${code} signal=${signal}. retry in ${RETRY_PERIOD / 1000} seconds`);
                        this.endpoint_info.s3rver_process = null;
                        P.delay(RETRY_PERIOD)
                            .then(() => {
                                if (this.enabled) {
                                    this._enable_service();
                                }
                            });
                    });
            } catch (err) {
                dbg.error('got error when spawning s3rver:', err);
            }
        } else {
            dbg.log0('got _enable_service on storage agent');
        }
    }

    _handle_s3rver_messages(message) {
        const dbg = this.dbg;
        dbg.log0(`got message from endpoint process:`, message);
        switch (message.code) {
            case 'WAITING_FOR_CERTS':
                this.endpoint_info.s3rver_process.send({
                    message: 'run_server',
                    base_address: this.master_address,
                    certs: this._ssl_certs,
                    location_info: this.location_info,
                });
                break;
            case 'STATS':
                // we also get here the name of the bucket and access key, but ignore it for now
                // later on we will want to send this data as well to nodes_monitor
                this.endpoint_info.stats = message.stats.reduce((sum, val) => ({
                    read_count: sum.read_count + val.read_count,
                    read_bytes: sum.read_bytes + val.read_bytes,
                    write_count: sum.write_count + val.write_count,
                    write_bytes: sum.write_bytes + val.write_bytes,
                }), this.endpoint_info.stats);
                break;
            case 'SRV_ERROR':
                dbg.error('got error from endpoint process: ', message);
                this.endpoint_info.srv_error = {
                    code: message.err_code,
                    message: message.err_msg
                };
                // kill s3rver process on error
                dbg.error('killing s3rver process', this.endpoint_info.s3rver_process.pid);
                this.endpoint_info.s3rver_process.kill();
                break;
            case 'STARTED_SUCCESSFULLY':
                dbg.log0('S3 server started successfully. clearing srv_error');
                this.endpoint_info.srv_error = undefined;
                break;
            default:
                dbg.error('got unknown message from endpoint - ', message);
                break;
        }
    }

    get_agent_info_and_update_masters(req) {
        const dbg = this.dbg;
        if (!this.is_started) return;
        const extended_hb = true;
        const ip = ip_module.address();
        dbg.log0('Recieved potential servers list', req.rpc_params.addresses);
        const prev_cpu_usage = this.cpu_usage;
        this.cpu_usage = process.cpuUsage();
        this.cpu_usage.time_stamp = time_utils.microstamp();
        const cpu_percent = (this.cpu_usage.user + this.cpu_usage.system - prev_cpu_usage.user - prev_cpu_usage.system) /
            (this.cpu_usage.time_stamp - prev_cpu_usage.time_stamp);
        const reply = {
            version: pkg.version || '',
            name: this.node_name || '',
            ip: ip,
            host_id: this.host_id,
            host_name: this.test_hostname || this.host_name,
            rpc_address: this.rpc_address || '',
            base_address: this.base_address,
            permission_tempering: this.permission_tempering,
            n2n_config: this.n2n_agent.get_plain_n2n_config(),
            enabled: this.enabled,
            geolocation: this.geolocation,
            debug_level: dbg.get_module_level('core'),
            node_type: this.node_type,
            mem_usage: process.memoryUsage().rss,
            cpu_usage: cpu_percent,
            location_info: this.location_info,
            io_stats: this.block_store && this.block_store.get_and_reset_io_stats()
        };
        if (this.cloud_info && this.cloud_info.pool_name) {
            reply.pool_name = this.cloud_info.pool_name;
        }
        if (this.mongo_info && this.mongo_info.pool_name) {
            reply.pool_name = this.mongo_info.pool_name;
        }

        if (this.endpoint_info) {
            reply.endpoint_info = _.pick(this.endpoint_info, ['stats', 'srv_error']);
            this.endpoint_info.stats = this._get_zeroed_stats_object();
        }

        this._test_server_connection();

        return P.resolve()
            .then(() => extended_hb && os_utils.os_info()
                .then(os_info => {
                    if (this.test_hostname) {
                        os_info.hostname = this.test_hostname;
                    }
                    reply.os_info = os_info;
                })
                .then(() => os_utils.get_distro().then(res => {
                    if (reply.os_info) {
                        reply.os_info.ostype = res;
                    }
                }))
                .catch(err => dbg.warn('failed to get detailed os info', err))
            )
            .then(() => this._update_servers_list(req.rpc_params.addresses))
            .then(() => this.create_node_token_wrapper.read())
            .then(create_node_token => {
                reply.create_node_token = create_node_token;
                return this.agent_conf.read();
            })
            .then(agent_conf => {
                reply.roles = agent_conf.roles;
            })
            .then(() => {
                if (this.block_store) {
                    return this.block_store.get_storage_info();
                }
            })
            .then(storage_info => {
                if (storage_info) {
                    dbg.log0('storage_info:', storage_info);
                    reply.storage = storage_info;

                    // treat small amount of used storage as 0 (under 200 KB) to avoid noisy 
                    // reporting in a new system
                    const MIN_USED_STORAGE = 200 * 1024;
                    if (storage_info.used < MIN_USED_STORAGE) {
                        dbg.log0(`used storage is under 200 KB (${storage_info.used}), treat as 0`);
                        storage_info.used = 0;
                    }
                    this._fix_storage_limit(reply.storage);
                }
            })
            .then(() => extended_hb && os_utils.read_drives()
                .catch(err => {
                    dbg.error('read_drives: ERROR', err.stack || err);
                })
            )
            .then(drives => {
                if (!drives || this.endpoint_info) return;
                // for now we only use a single drive,
                // so mark the usage on the drive of our storage folder.
                const used_size = reply.storage.used;
                const used_drives = _.filter(drives, drive => {
                    dbg.log0('used drives:', this.storage_path_mount, drive, used_size);
                    //if there is no this.storage_path_mount, it's a memory agent for testing.
                    if (drive.temporary_drive) return false;
                    if (this.storage_path_mount === drive.mount || !this.storage_path_mount) {
                        drive.storage.used = used_size;
                        this._fix_storage_limit(drive.storage);
                        return true;
                    }
                    return false;
                });
                reply.drives = used_drives;
                dbg.log0('DRIVES:', drives, 'used drives', used_drives);
                // _.each(drives, drive => {
                //     if (this.storage_path_mount === drive.mount) {
                //         drive.storage.used = used_size;
                //     }
                // });
            })
            .then(() => {
                if (this.node_type === 'BLOCK_STORE_FS') {
                    const start_port = reply.n2n_config.tcp_permanent_passive.min || reply.n2n_config.tcp_permanent_passive.port;
                    const end_port = reply.n2n_config.tcp_permanent_passive.max || reply.n2n_config.tcp_permanent_passive.port;
                    return os_utils.is_port_range_open_in_firewall([ip], start_port, end_port)
                        .then(ports_allowed => {
                            reply.ports_allowed = ports_allowed;
                        });
                }
            })
            .then(() => net_utils.retrieve_public_ip())
            .then(public_ip => {
                if (public_ip) {
                    reply.public_ip = public_ip;
                }
            })
            .return(reply);
    }

    async get_agent_storage_info(req) {
        const dbg = this.dbg;
        const info = { storage: {} };
        if (this.block_store) {
            const storage_info = await this.block_store.get_storage_info();
            const MIN_USED_STORAGE = 200 * 1024;
            if (storage_info.used < MIN_USED_STORAGE) {
                dbg.log0(`used storage is under 200 KB (${storage_info.used}), treat as 0`);
                storage_info.used = 0;
            }
            this._fix_storage_limit(storage_info);
            info.storage = storage_info;
        }
        dbg.log0('get_agent_storage_info: received storage_info request', info);
        return info;
    }

    update_auth_token(req) {
        const dbg = this.dbg;
        const auth_token = req.rpc_params.auth_token;
        dbg.log0('update_auth_token: received new token');
        return P.resolve()
            .then(() => {
                if (this.storage_path) {
                    const token_path = path.join(this.storage_path, 'token');
                    dbg.log0('update_auth_token: write new token', token_path);
                    return this.token_wrapper.write(auth_token);
                }
            })
            .then(() => {
                dbg.log0('update_auth_token: using new token');
                this.client.options.auth_token = auth_token;
            });
    }

    update_create_node_token(req) {
        const dbg = this.dbg;
        dbg.log0('update_create_node_token: received new token', req.rpc_params);
        return this.create_node_token_wrapper.write(req.rpc_params.create_node_token);
    }

    update_rpc_config(req) {
        const dbg = this.dbg;
        const n2n_config = req.rpc_params.n2n_config;
        const rpc_address = req.rpc_params.rpc_address;
        const old_rpc_address = this.rpc_address;
        const base_address = req.rpc_params.base_address;
        dbg.log0('update_rpc_config', req.rpc_params);

        return this._update_rpc_config_internal({
            n2n_config: n2n_config,
            rpc_address: rpc_address,
            old_rpc_address: old_rpc_address,
            base_address: base_address,
            store_base_address: !_.isUndefined(base_address),
        });
    }


    n2n_signal(req) {
        return this.rpc.accept_n2n_signal(req.rpc_params);
    }

    async test_store_perf(req) {
        if (!this.block_store) return {};
        return this.block_store.test_store_perf(req.rpc_params);
    }

    test_network_perf(req) {
        const dbg = this.dbg;
        const data = req.rpc_params[RPC_BUFFERS] &&
            req.rpc_params[RPC_BUFFERS].data;
        const req_len = data ? data.length : 0;
        const res_len = req.rpc_params.response_length;

        dbg.log1('test_network_perf:',
            'req_len', req_len,
            'res_len', res_len,
            'source', req.rpc_params.source,
            'target', req.rpc_params.target);

        if (req.rpc_params.target !== this.rpc_address) {
            throw new Error('test_network_perf: wrong address ' +
                req.rpc_params.target + ' mine is ' + this.rpc_address);
        }

        return {
            [RPC_BUFFERS]: { data: Buffer.alloc(res_len) }
        };
    }

    test_network_perf_to_peer(req) {
        const dbg = this.dbg;
        const target = req.rpc_params.target;
        const source = req.rpc_params.source;
        const req_len = req.rpc_params.request_length;
        const res_len = req.rpc_params.response_length;
        const concur = req.rpc_params.concur;
        let count = req.rpc_params.count;

        dbg.log0('test_network_perf_to_peer:',
            'source', source,
            'target', target,
            'req_len', req_len,
            'res_len', res_len,
            'count', count,
            'concur', concur);

        if (source !== this.rpc_address) {
            throw new Error('test_network_perf_to_peer: wrong address ' +
                source + ' mine is ' + this.rpc_address);
        }
        const reply = {};

        const next = () => {
            if (count <= 0) return;
            count -= 1;
            // read/write from target agent
            return this.client.agent.test_network_perf({
                    source: source,
                    target: target,
                    response_length: res_len,
                    [RPC_BUFFERS]: { data: Buffer.alloc(req_len) }
                }, {
                    address: target,
                    return_rpc_req: true // we want to check req.connection
                })
                .then(io_req => {
                    const data = io_req.reply[RPC_BUFFERS].data;
                    if (((!data || !data.length) && res_len > 0) ||
                        (data && data.length && data.length !== res_len)) {
                        throw new Error('test_network_perf_to_peer: response_length mismatch');
                    }
                    const session = io_req.connection.session;
                    reply.session = session && session.key;
                    return next();
                });
        };

        return P.all(_.times(concur, next)).return(reply);
    }

    collect_diagnostics(req) {
        const dbg = this.dbg;
        dbg.log1('Recieved diag req', req);
        const is_windows = (process.platform === "win32");
        const inner_path = is_windows ? process.env.ProgramData + '/agent_diag.tgz' : '/tmp/agent_diag.tgz';

        return P.resolve()
            .then(() => diag.collect_agent_diagnostics(this.storage_path))
            .then(() => diag.pack_diagnostics(inner_path))
            .catch(err => {
                dbg.error('DIAGNOSTICS COLLECTION FAILED', err.stack || err);
                throw new Error('Agent Collect Diag Error on collecting diagnostics');
            })
            .then(() => {
                dbg.log1('Reading packed file');
                return fs.readFileAsync(inner_path)
                    .then(data => ({
                        [RPC_BUFFERS]: { data }
                    }))
                    .catch(err => {
                        dbg.error('DIAGNOSTICS READ FAILED', err.stack || err);
                        throw new Error('Agent Collect Diag Error on reading packges diag file');
                    });
            })
            .catch(err => {
                dbg.error('DIAGNOSTICS FAILED', err.stack || err);
                return {
                    data: Buffer.alloc(0),
                };
            });
    }

    set_debug_node(req) {
        const dbg = this.dbg;
        dbg.log0('Recieved set debug req ', req.rpc_params.level);
        dbg.set_level(req.rpc_params.level, 'core');
        if (this.endpoint_info && this.endpoint_info.s3rver_process) {
            this.endpoint_info.s3rver_process.send({
                message: 'set_debug',
                level: req.rpc_params.level
            });
        }
        if (req.rpc_params.level > 0) { //If level was set, unset it after a T/O
            promise_utils.delay_unblocking(config.DEBUG_MODE_PERIOD)
                .then(() => {
                    dbg.set_level(0, 'core');
                    if (this.endpoint_info.s3rver_process) {
                        this.endpoint_info.s3rver_process.send({
                            message: 'set_debug',
                            level: 0
                        });
                    }
                });
        }
    }

    uninstall() {
        return P.resolve()
            .then(() => {
                const dbg = this.dbg;
                dbg.log1('Recieved unintsall req');
                if (os.type() === 'Darwin') return;
                P.delay(30 * 1000) // this._disable_service()
                    .then(() => {
                        this.send_message_and_exit('UNINSTALL', 85); // 85 is 'U' in ascii
                    });
            });
    }

    fix_storage_permissions() {
        if (os.type() !== 'Windows_NT') return P.resolve();
        const dbg = this.dbg;
        const root_path = path.win32.parse(this.storage_path).dir;
        return P.resolve()
            .then(() => os_utils.is_folder_permissions_set(root_path))
            .then(permissions_set => {
                if (!permissions_set && (this.node_type !== 'ENDPOINT_S3')) {
                    os_utils.set_win_folder_permissions(root_path)
                        .catch(err => dbg.error('Icacls configuration failed with:', err));
                }
            })
            .then(() => {
                dbg.log0('fix_storage_permissions configuration success');
                this.permission_tempering = false;
            })
            .catch(function(err) {
                dbg.error('fix_storage_permissions configuration failed with:', err);
                throw new Error('fix_storage_permissions configuration failed!');
            });
    }

    async send_message_and_exit(message_code, exit_code) {
        const dbg = this.dbg;
        // if we have an open ipc channel than send the message. otherwise exit
        if (process.send) {
            dbg.log0(`sending message ${message_code} to parent process (agent_wrapper)`);
            process.send({ code: message_code });
            // set timeout for 2 minutes to exit agent if not killed already
            const timeout = 2 * 60000;
            setTimeout(() => {
                dbg.log0(`expected this process to get killed by now but still alive. exiting with code ${exit_code}`);
                process.exit(exit_code);
            }, timeout);
        } else {
            dbg.log0(`no messages channel to parent process. exit with code ${exit_code}`);
            process.exit(exit_code);
        }
    }

}

module.exports = Agent;
