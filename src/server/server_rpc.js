'use strict';

var api = require('../api');

// using the api rpc instance.
// we can certainly create a new one, but we don't need for now.
var server_rpc = api.rpc;
var bg_workers_rpc = api.rpc;

// base rpc address for server is redirected locally
server_rpc.base_address = 'fcall://fcall';

// base rpc address for background workers is local, but a different process
bg_workers_rpc.base_address = bg_workers_rpc.get_default_base_address();

module.exports = {
    server_rpc: server_rpc,
    bg_workers_rpc: bg_workers_rpc
};

var options = {
    // setup the rpc authorizer to check the request auth_token
    authorize: require('./auth_server').authorize,
};

server_rpc.register_service(api.schema.auth_api, require('./auth_server'), options);
server_rpc.register_service(api.schema.account_api, require('./account_server'), options);
server_rpc.register_service(api.schema.system_api, require('./system_server'), options);
server_rpc.register_service(api.schema.tier_api, require('./tier_server'), options);
server_rpc.register_service(api.schema.node_api, require('./node_server'), options);
server_rpc.register_service(api.schema.bucket_api, require('./bucket_server'), options);
server_rpc.register_service(api.schema.object_api, require('./object_server'), options);
server_rpc.register_service(api.schema.stats_api, require('./stats_aggregator'), options);
