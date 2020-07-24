/* Copyright (C) 2016 NooBaa */
'use strict';

const url = require('url');

const server_rpc = require('./server_rpc');
const db_client = require('../util/db_client');

async function register_rpc() {
    db_client.instance().connect();

    server_rpc.register_object_services();
    server_rpc.register_func_services();
    server_rpc.register_common_services();

    const u = url.parse(server_rpc.rpc.router.md);
    await server_rpc.rpc.start_http_server({
        port: u.port,
        protocol: u.protocol,
        logging: true,
    });

    server_rpc.rpc.router.md = 'fcall://fcall';
    return server_rpc.rpc;
}

exports.register_rpc = register_rpc;
