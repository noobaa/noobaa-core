/* Copyright (C) 2016 NooBaa */
'use strict';

/* eslint-disable global-require */

const api = require('../api');
const { format_base_address } = require('../util/addr_utils');
const jwt_utils = require('../util/jwt_utils');

class ServerRpc {

    constructor() {
        this.rpc = api.new_rpc();
        this.client = this.rpc.new_client({ auth_token: jwt_utils.make_auth_token() });

        // n2n proxy allows any service reach n2n agents
        // without registering an n2n agent by proxying requests
        // using the node server
        this.rpc.register_n2n_proxy((...args) => this.client.node.n2n_proxy(...args));
    }

    get_base_address(base_hostname) {
        return format_base_address(base_hostname);
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

    set_new_router(params) {
        // check if some domains are changed to fcall://fcall
        const fcalls = Object.entries(this.rpc.router)
            .reduce((list, pair) => {
                const [domain, addr] = pair;
                if (addr === 'fcall://fcall') list.push(domain);
                return list;
            }, []);

        if (params.base_address) {
            const new_router = api.new_router_from_base_address(
                this.get_base_address(params.base_address)
            );
            new_router.master = this.rpc.router.master;
            this.rpc.router = new_router;
        }

        if (params.master_address) {
            this.rpc.router.master = this.get_base_address(params.master_address);
        }

        // restore default to fcall if needed
        for (const domain of fcalls) {
            this.rpc.router[domain] = 'fcall://fcall';
        }
    }

    is_service_registered(service) {
        return this.rpc.is_service_registered(service);
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
        rpc.register_service(schema.cluster_server_api,
            require('./system_services/cluster_server'), options);
        rpc.register_service(schema.cluster_internal_api,
            require('./system_services/cluster_server'), options);
        rpc.register_service(schema.stats_api,
            require('./system_services/stats_aggregator'), options);
        rpc.register_service(schema.events_api,
            require('./notifications/event_server.js'), options);
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
        rpc.register_service(schema.host_api,
            require('./node_services/host_server'), options);
    }

    register_object_services() {
        let rpc = this.rpc;
        let schema = rpc.schema;
        let options = this.get_server_options();
        rpc.register_service(schema.object_api,
            require('./object_services/object_server'), options);
    }

    register_func_services() {
        let rpc = this.rpc;
        let schema = rpc.schema;
        let options = this.get_server_options();
        rpc.register_service(schema.func_api,
            require('./func_services/func_server'), options);
    }

    register_bg_services() {
        let rpc = this.rpc;
        let schema = rpc.schema;
        let options = this.get_server_options();
        rpc.register_service(schema.scrubber_api,
            require('./bg_services/scrubber'), options);
        rpc.register_service(schema.replication_api,
            require('./bg_services/replication_server'), options);
    }

    register_hosted_agents_services() {
        let rpc = this.rpc;
        let schema = rpc.schema;
        let options = this.get_server_options();
        rpc.register_service(schema.hosted_agents_api,
            require('../hosted_agents/hosted_agents'), options);
    }

    register_common_services() {
        let rpc = this.rpc;
        let schema = rpc.schema;
        let options = this.get_server_options();
        rpc.register_service(schema.auth_api,
            require('./common_services/auth_server'), options);
        rpc.register_service(schema.debug_api,
            require('./common_services/debug_server'), options);
        rpc.register_service(schema.server_inter_process_api,
            require('./common_services/server_inter_process'), options);
    }

}

module.exports = new ServerRpc(); // singleton
