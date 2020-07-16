/* Copyright (C) 2016 NooBaa */
'use strict';

require('../util/dotenv').load();
require('../util/panic');
require('../util/fips');

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
    const u = url.parse(server_rpc.rpc.router.hosted_agents);
    return server_rpc.rpc.start_http_server({
        port: u.port,
        protocol: u.protocol,
        logging: true,
    });
}
