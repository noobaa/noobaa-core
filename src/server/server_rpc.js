'use strict';

let api = require('../api');

class ServerRpc {

    constructor() {
        this.rpc = api.new_rpc();
        this.client = this.rpc.new_client();
        // redirection function is used by the node_server
        // to forward calls using the redirector server
        // to reach the specific node_server instance that has
        // a direct connection to the agent.
        this.rpc.register_redirector_transport(this.client.redirector.redirect);
    }

    get_server_options() {
        let system_store = require('./system_services/system_store').get_instance();
        let auth_server = require('./common_services/auth_server');
        return {
            middleware: [
                // refresh the system_store on request arrival
                system_store.refresh_middleware,
                // setup the rpc authorizer to check the request auth_token
                auth_server.authorize,
            ]
        };
    }

    register_system_services() {
        let rpc = this.rpc;
        let schema = rpc.schema;
        let options = this.get_server_options();
        rpc.register_service(schema.account_api,
            require('./system_services/account_server'), options);
        rpc.register_service(schema.system_api,
            require('./system_services/system_server'), options);
        rpc.register_service(schema.tier_api,
            require('./system_services/tier_server'), options);
        rpc.register_service(schema.tiering_policy_api,
            require('./system_services/tier_server'), options);
        rpc.register_service(schema.bucket_api,
            require('./system_services/bucket_server'), options);
        rpc.register_service(schema.pool_api,
            require('./system_services/pool_server'), options);
        rpc.register_service(schema.stats_api,
            require('./system_services/stats_aggregator'), options);
        rpc.register_service(schema.cluster_server_api,
            require('./system_services/cluster_server'), options);

        rpc.register_service(schema.redirector_api,
            require('./system_services/redirector'), {
            // the redirector should not try refresh system_store
            // because it doesn't use it and system_store calls the redirector,
            // so would deadlock.
            middleware: [
                require('./common_services/auth_server').authorize
            ]
        });
    }

    register_node_services() {
        let rpc = this.rpc;
        let schema = rpc.schema;
        let options = this.get_server_options();
        rpc.register_service(schema.node_api,
            require('./node_services/node_server'), options);
    }

    register_object_services() {
        let rpc = this.rpc;
        let schema = rpc.schema;
        let options = this.get_server_options();
        rpc.register_service(schema.object_api,
            require('./object_services/object_server'), options);
    }

    register_bg_services() {
        let rpc = this.rpc;
        let schema = rpc.schema;
        let options = this.get_server_options();
        rpc.register_service(schema.cloud_sync_api,
            require('./bg_services/cloud_sync'), options);
        rpc.register_service(schema.hosted_agents_api,
            require('./bg_services/hosted_agents'), options);
    }

    register_common_services() {
        let rpc = this.rpc;
        let schema = rpc.schema;
        let options = this.get_server_options();
        rpc.register_service(schema.auth_api,
            require('./common_services/auth_server'), options);
        rpc.register_service(schema.debug_api,
            require('./common_services/debug_server'), options);
        rpc.register_service(schema.cluster_member_api,
            require('./common_services/cluster_member'), options);
    }

}

module.exports = new ServerRpc(); // singleton
