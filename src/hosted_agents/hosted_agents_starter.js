'use strict';

require('../util/dotenv').load();

const url = require('url');

const dbg = require('../util/debug_module')(__filename);
const server_rpc = require('../server/server_rpc');
const mongo_client = require('../util/mongo_client');

dbg.set_process_name('HostedAgents');
mongo_client.instance().connect();

register_rpc();

function register_rpc() {
    server_rpc.register_hosted_agents_services();
    server_rpc.register_common_services();
    let http_port = url.parse(server_rpc.rpc.router.hosted_agents).port;
    return server_rpc.rpc.start_http_server({
        port: http_port,
        ws: true,
        logging: true,
        secure: false,
    });
}
