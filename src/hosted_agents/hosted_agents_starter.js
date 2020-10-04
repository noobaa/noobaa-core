/* Copyright (C) 2016 NooBaa */
'use strict';

require('../util/dotenv').load();
require('../util/panic');
require('../util/fips');

const dbg = require('../util/debug_module')(__filename);
dbg.set_process_name('HostedAgents');

const url = require('url');
const server_rpc = require('../server/server_rpc');
const db_client = require('../util/db_client');
const prom_reporting = require('../server/analytic_services/prometheus_reporting');
const config = require('../../config.js');

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

async function start_hosted_agents() {
    await Promise.all([
        db_client.instance().connect(),
        register_rpc(),

        // Try to start the hosted agents metrics server
        prom_reporting.start_server(config.HA_METRICS_SERVER_PORT)
    ]);
}

start_hosted_agents();
