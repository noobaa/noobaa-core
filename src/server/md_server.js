/* Copyright (C) 2016 NooBaa */
'use strict';

const url = require('url');

const server_rpc = require('./server_rpc');
const mongoose_utils = require('../util/mongoose_utils');
const mongo_client = require('../util/mongo_client');

mongoose_utils.mongoose_connect();
mongo_client.instance().connect();

server_rpc.register_object_services();
server_rpc.register_func_services();
server_rpc.register_common_services();

function register_rpc() {
    // TODO missing? server_rpc.rpc.router.md = 'fcall://fcall';
    const u = url.parse(server_rpc.rpc.router.md);
    return server_rpc.rpc.start_http_server({
        port: u.port,
        protocol: u.protocol,
        logging: true,
    }).return(server_rpc.rpc);
}

exports.register_rpc = register_rpc;
