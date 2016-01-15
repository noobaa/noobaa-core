'use strict';

var api = require('../api');
var bg_workers_rpc = api.rpc;
var server_rpc = api.new_rpc();

module.exports = {
    server_rpc: server_rpc,
    bg_workers_rpc: bg_workers_rpc,
};

// base rpc address for bg server is redirected locally
bg_workers_rpc.base_address = 'fcall://fcall';

//Allow redirection from this point, lookup will be localhost
server_rpc.register_redirector_transport();
bg_workers_rpc.register_redirector_transport();

bg_workers_rpc.register_service(api.schema.cloud_sync_api, require('./cloud_sync_rpc'));
bg_workers_rpc.register_service(api.schema.redirector_api, require('./redirector'));
bg_workers_rpc.register_service(api.schema.debug_api, require('../server/debug_server'));
bg_workers_rpc.register_service(api.schema.cluster_api, require('../server/cluster_server'));
