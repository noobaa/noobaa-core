'use strict';

var Client = require('./api_client');

module.exports = {
    Client: Client,
    rpc: Client.rpc,
    schema: Client.schema,
};
