'use strict';

const url = require('url');

const server_rpc = require('./server_rpc');
const mongoose_utils = require('../util/mongoose_utils');
const mongo_client = require('../util/mongo_client').get_instance();

mongoose_utils.mongoose_connect();
mongo_client.connect();

server_rpc.register_object_services();
server_rpc.register_common_services();

function register_rpc() {
    let http_port = url.parse(server_rpc.rpc.router.md).port;
    return server_rpc.rpc.start_http_server({
        port: http_port,
        ws: true,
        logging: true,
        secure: false,
    }).return(server_rpc.rpc);
}

exports.register_rpc = register_rpc;
