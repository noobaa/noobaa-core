'use strict';

let api = require('../api');

class ServerRpc {

    constructor() {
        this.rpc = api.new_rpc();
        this.client = this.rpc.new_client();
        this.bg_client = this.rpc.new_client({
            domain: 'bg'
        });
        // redirection function is used by the node_server
        // to forward calls using the redirector server
        // to reach the specific node_server instance that has
        // a direct connection to the agent.
        this.rpc.register_redirector_transport(this.bg_client.redirector.redirect);

    }

    get_server_options() {
        let system_store = require('./stores/system_store');
        let auth_server = require('./auth_server');
        return {
            middleware: [
                // refresh the system_store on request arrival
                system_store.refresh_middleware,
                // setup the rpc authorizer to check the request auth_token
                auth_server.authorize,
            ]
        };
    }

    register_md_servers() {
        let rpc = this.rpc;
        let schema = rpc.schema;
        let options = this.get_server_options();
        rpc.register_service(schema.auth_api, require('./auth_server'), options);
        rpc.register_service(schema.account_api, require('./account_server'), options);
        rpc.register_service(schema.system_api, require('./system_server'), options);
        rpc.register_service(schema.tier_api, require('./tier_server'), options);
        rpc.register_service(schema.tiering_policy_api, require('./tier_server'), options);
        rpc.register_service(schema.node_api, require('./node_server'), options);
        rpc.register_service(schema.bucket_api, require('./bucket_server'), options);
        rpc.register_service(schema.object_api, require('./object_server'), options);
        rpc.register_service(schema.pool_api, require('./pool_server'), options);
        rpc.register_service(schema.stats_api, require('./stats_aggregator'), options);
    }

    register_bg_servers() {
        let rpc = this.rpc;
        let schema = rpc.schema;
        let options = this.get_server_options();
        rpc.register_service(schema.redirector_api, require('../bg_workers/redirector'), {
            // the redirector should not try refresh system_store
            // because it doesn't use it and system_store calls the redirector,
            // so would deadlock.
            middleware: [
                require('./auth_server').authorize
            ]
        });
        rpc.register_service(schema.cloud_sync_api,
            require('../bg_workers/cloud_sync_rpc'), options);
    }

    register_common_servers() {
        let rpc = this.rpc;
        let schema = rpc.schema;
        let options = this.get_server_options();
        rpc.register_service(schema.debug_api, require('./debug_server'), options);
        rpc.register_service(schema.cluster_api, require('./cluster_server'), options);
    }

}

module.exports = new ServerRpc(); // singleton
