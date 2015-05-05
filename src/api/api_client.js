'use strict';

var _ = require('lodash');
var RPC = require('../rpc/rpc');
var RpcSchema = require('../rpc/rpc_schema');
var ObjectClient = require('./object_client');

module.exports = Client;

// the api client defines rpc and schema instances to be used
// by clients and servers. since RPC and RpcSchema are general classes
// this is where we instantiate them as singletons.
var rpc = new RPC();
var schema = new RpcSchema();
Client.rpc = rpc;
Client.schema = schema;

// registring all api's on the same RpcSchema object
// so they share the schema namespace
schema.register_api(require('./common_api'));
schema.register_api(require('./auth_api'));
schema.register_api(require('./account_api'));
schema.register_api(require('./system_api'));
schema.register_api(require('./tier_api'));
schema.register_api(require('./node_api'));
schema.register_api(require('./bucket_api'));
schema.register_api(require('./object_api'));
schema.register_api(require('./agent_api'));

/**
 *
 * CLIENT
 *
 * construct a single client with shared options and headers
 * for fast access to all api clients.
 *
 * @param base - optional client instance to copy options and headers.
 */
function Client(default_options) {
    var self = this;

    // use prototype inheritance to create new object but with defaults
    self.options = _.create(default_options);

    self.auth = rpc.create_client(schema.auth_api, self.options);
    self.account = rpc.create_client(schema.account_api, self.options);
    self.system = rpc.create_client(schema.system_api, self.options);
    self.tier = rpc.create_client(schema.tier_api, self.options);
    self.node = rpc.create_client(schema.node_api, self.options);
    self.agent = rpc.create_client(schema.agent_api, self.options);
    self.bucket = rpc.create_client(schema.bucket_api, self.options);
    self.object = rpc.create_client(schema.object_api, self.options);

    // TODO this is abusing this client as the signal_client for the rpc
    rpc.send_signal = self.node.send_signal;

    // the object client is a "heavy" object with caches
    self.object_client = new ObjectClient(self.object, self.agent);

    /**
     * authenticate using the provided params,
     * and save the token in options for next calls.
     */
    self.create_auth_token = function(params) {
        return self.auth.create_auth(params).then(function(res) {
            self.options.auth_token = res.token;
            return res;
        });
    };

    self.create_access_key_auth = function(params) {
        return self.auth.create_access_key_auth(params).then(function(res) {
            self.options.auth_token = res.token;
            return res;
        });
    };

}
