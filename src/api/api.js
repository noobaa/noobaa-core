'use strict';

let _ = require('lodash');
let RPC = require('../rpc/rpc');
let RpcSchema = require('../rpc/rpc_schema');
let url = require('url');

// registring all api's on the same RpcSchema object
// so they share the schema namespace
let api_schema = new RpcSchema();
api_schema.register_api(require('./common_api'));
api_schema.register_api(require('./auth_api'));
api_schema.register_api(require('./account_api'));
api_schema.register_api(require('./system_api'));
api_schema.register_api(require('./tier_api'));
api_schema.register_api(require('./node_api'));
api_schema.register_api(require('./bucket_api'));
api_schema.register_api(require('./object_api'));
api_schema.register_api(require('./agent_api'));
api_schema.register_api(require('./block_store_api'));
api_schema.register_api(require('./stats_api'));
api_schema.register_api(require('./cloud_sync_api'));
api_schema.register_api(require('./debug_api'));
api_schema.register_api(require('./redirector_api'));
api_schema.register_api(require('./tiering_policy_api'));
api_schema.register_api(require('./pool_api'));
api_schema.register_api(require('./cluster_server_api'));
api_schema.register_api(require('./cluster_member_api'));
api_schema.register_api(require('./hosted_agents_api'));
api_schema.compile();

/**
 * extend the rpc client prototype with convinient methods
 */
RPC.Client.prototype.create_auth_token = function(params) {
    return this.auth.create_auth(params)
        .then(res => {
            this.options.auth_token = res.token;
            return res;
        });
};
RPC.Client.prototype.create_access_key_auth = function(params) {
    return this.auth.create_access_key_auth(params)
        .then(res => {
            this.options.auth_token = res.token;
            return res;
        });
};

function default_base_address() {
    // the default 5001 port is for development
    return 'ws://127.0.0.1:' + (parseInt(process.env.PORT, 10) || 5001);
}

function new_router(base_address) {
    if (!base_address) {
        base_address = default_base_address();
    }
    let base_url = _.pick(url.parse(base_address),
        'protocol', 'hostname', 'port', 'slashes');
    let base_addr = url.format(base_url);
    base_url.port = parseInt(base_url.port, 10) + 1;
    let md_addr = url.format(base_url);
    base_url.port = parseInt(base_url.port, 10) + 1;
    let bg_addr = url.format(base_url);
    let router = {
        default: base_addr,
        md: md_addr,
        bg: bg_addr
    };
    console.log('ROUTER', router);
    return router;
}

function new_rpc(base_address) {
    let rpc = new RPC({
        schema: api_schema,
        router: new_router(base_address),
        api_routes: {
            object_api: 'md',
            cloud_sync_api: 'bg',
            hosted_agents_api: 'bg'
        }
    });
    return rpc;
}

module.exports = {
    new_rpc: new_rpc,
    new_router: new_router,
    default_base_address: default_base_address,
};
