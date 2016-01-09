'use strict';

var api = require('../api');

// using the api rpc instance.
// we can certainly create a new one, but we don't need for now.
var server_rpc = api.rpc;
var bg_worker_client = api.bg_workers_client;

// base rpc address for server is redirected locally
server_rpc.base_address = 'fcall://fcall';

module.exports = {
    server_rpc: server_rpc,
    bg_worker: bg_worker_client,
    register_servers: register_servers,
};

function register_servers() {
    var system_store = require('./stores/system_store');
    var auth_server = require('./auth_server');
    var options = {
        middleware: [
            function(req) {
                return system_store.get();
            },
            // setup the rpc authorizer to check the request auth_token
            auth_server.authorize,
        ]
    };

    server_rpc.register_service(api.schema.auth_api, require('./auth_server'), options);
    server_rpc.register_service(api.schema.account_api, require('./account_server'), options);
    server_rpc.register_service(api.schema.system_api, require('./system_server'), options);
    server_rpc.register_service(api.schema.tier_api, require('./tier_server'), options);
    server_rpc.register_service(api.schema.tiering_policy_api, require('./tier_server'), options);
    server_rpc.register_service(api.schema.node_api, require('./node_server'), options);
    server_rpc.register_service(api.schema.bucket_api, require('./bucket_server'), options);
    server_rpc.register_service(api.schema.object_api, require('./object_server'), options);
    server_rpc.register_service(api.schema.pool_api, require('./pool_server'), options);
    server_rpc.register_service(api.schema.stats_api, require('./stats_aggregator'), options);
    server_rpc.register_service(api.schema.debug_api, require('./debug_server'));
}
