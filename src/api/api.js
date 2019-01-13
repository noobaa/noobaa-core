/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const url = require('url');
const { RPC, RPC_BUFFERS, RpcSchema } = require('../rpc');

// registring all api's on the same RpcSchema object
// so they share the schema namespace
const api_schema = new RpcSchema();
api_schema.register_api(require('./common_api'));
api_schema.register_api(require('./auth_api'));
api_schema.register_api(require('./account_api'));
api_schema.register_api(require('./system_api'));
api_schema.register_api(require('./tier_api'));
api_schema.register_api(require('./node_api'));
api_schema.register_api(require('./host_api'));
api_schema.register_api(require('./bucket_api'));
api_schema.register_api(require('./events_api'));
api_schema.register_api(require('./object_api'));
api_schema.register_api(require('./agent_api'));
api_schema.register_api(require('./block_store_api'));
api_schema.register_api(require('./stats_api'));
api_schema.register_api(require('./scrubber_api'));
api_schema.register_api(require('./debug_api'));
api_schema.register_api(require('./redirector_api'));
api_schema.register_api(require('./tiering_policy_api'));
api_schema.register_api(require('./pool_api'));
api_schema.register_api(require('./cluster_server_api'));
api_schema.register_api(require('./cluster_internal_api'));
api_schema.register_api(require('./upgrade_api'));
api_schema.register_api(require('./server_inter_process_api'));
api_schema.register_api(require('./hosted_agents_api'));
api_schema.register_api(require('./frontend_notifications_api'));
api_schema.register_api(require('./func_api'));
api_schema.register_api(require('./func_node_api'));
api_schema.compile();

class APIClient {

    constructor(rpc, default_options) {
        this.rpc = rpc;
        this.options = _.create(default_options);
        this.RPC_BUFFERS = RPC_BUFFERS;

        // define the client properties
        this.auth = undefined;
        this.account = undefined;
        this.system = undefined;
        this.tier = undefined;
        this.node = undefined;
        this.host = undefined;
        this.bucket = undefined;
        this.events = undefined;
        this.object = undefined;
        this.agent = undefined;
        this.block_store = undefined;
        this.stats = undefined;
        this.scrubber = undefined;
        this.debug = undefined;
        this.redirector = undefined;
        this.tiering_policy = undefined;
        this.pool = undefined;
        this.cluster_server = undefined;
        this.cluster_internal = undefined;
        this.upgrade = undefined;
        this.server_inter_process = undefined;
        this.hosted_agents = undefined;
        this.frontend_notifications = undefined;
        this.func = undefined;
        this.func_node = undefined;

        _.each(rpc.schema, api => {
            if (!api || !api.id || api.id[0] === '_') return;
            const name = api.id.replace(/_api$/, '');
            if (name === 'rpc' || name === 'options') throw new Error('ILLEGAL API ID');
            this[name] = {};
            _.each(api.methods, (method_api, method_name) => {
                this[name][method_name] = (params, options) => {
                    options = _.create(this.options, options);
                    return rpc._request(api, method_api, params, options);
                };
            });
        });
    }

    /**
     * extend the rpc client prototype with convinient methods
     */
    create_auth_token(params) {
        return this.auth.create_auth(params)
            .then(res => {
                this.options.auth_token = res.token;
                return res;
            });
    }

    create_access_key_auth(params) {
        return this.auth.create_access_key_auth(params)
            .then(res => {
                this.options.auth_token = res.token;
                return res;
            });
    }

}


function get_base_port(base_port) {
    // the default 5443 port is for development
    return base_port || parseInt(process.env.SSL_PORT, 10) || 5443;
}

function get_base_address(base_hostname, base_port) {
    return 'wss://' + (base_hostname || '127.0.0.1') + ':' + get_base_port(base_port);
}

function new_router(base_address, master_base_address) {
    if (!base_address) {
        base_address = get_base_address();
    }
    let base_url = _.pick(url.parse(base_address),
        'protocol', 'hostname', 'port', 'slashes');
    let base_addr = url.format(base_url);
    base_url.port = parseInt(base_url.port, 10) + 1;
    let md_addr = url.format(base_url);
    base_url.port = parseInt(base_url.port, 10) + 1;
    let bg_addr = url.format(base_url);
    base_url.port = parseInt(base_url.port, 10) + 1;
    let hosted_agents_addr = url.format(base_url);
    let master_base_addr;
    if (master_base_address) {
        let master_url = _.pick(url.parse(master_base_address),
            'protocol', 'hostname', 'port', 'slashes');
        master_base_addr = url.format(master_url);
    } else {
        master_base_addr = base_addr;
    }
    let router = {
        default: base_addr,
        md: md_addr,
        bg: bg_addr,
        hosted_agents: hosted_agents_addr,
        master: master_base_addr
    };
    console.log('ROUTER', router);
    return router;
}

function new_rpc(base_address) {
    let rpc = new RPC({
        APIClient,
        schema: api_schema,
        router: new_router(base_address),
        api_routes: {
            object_api: 'md',
            func_api: 'md',
            scrubber_api: 'bg',
            hosted_agents_api: 'hosted_agents',
            node_api: 'master',
            host_api: 'master'
        }
    });
    return rpc;
}

/**
 *
 * The following sets all routes to use only the default base address.
 *
 * This mode is needed for the frontend browser (see reason below),
 * and we must assure the default base address will serve all the apis
 * needed by the frontend.
 *
 * The reason for this is that the browser does not allow to connect to wss:// host
 * that has self-signed certificate, other than the page host.
 * Trying to do so will immediately error with "WebSocket opening handshake was canceled".
 *
 */
function new_rpc_default_only(base_address) {
    let rpc = new RPC({
        schema: api_schema,
        router: {
            default: base_address
        },
        api_routes: {}
    });
    return rpc;
}

module.exports = {
    new_rpc: new_rpc,
    new_rpc_default_only: new_rpc_default_only,
    new_router: new_router,
    get_base_address: get_base_address,
    get_base_port: get_base_port,
};
