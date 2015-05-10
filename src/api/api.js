'use strict';

var _ = require('lodash');
var RPC = require('../rpc/rpc');
var RpcSchema = require('../rpc/rpc_schema');
var ObjectClient = require('./object_client');

// registring all api's on the same RpcSchema object
// so they share the schema namespace
var api_schema = new RpcSchema();
api_schema.register_api(require('./common_api'));
api_schema.register_api(require('./auth_api'));
api_schema.register_api(require('./account_api'));
api_schema.register_api(require('./system_api'));
api_schema.register_api(require('./tier_api'));
api_schema.register_api(require('./node_api'));
api_schema.register_api(require('./bucket_api'));
api_schema.register_api(require('./object_api'));
api_schema.register_api(require('./agent_api'));

var api_rpc = new RPC({
    schema: api_schema
});

module.exports = {
    schema: api_schema,
    rpc: api_rpc,
    Client: Client,
};

/**
 *
 * CLIENT
 *
 * @param default_options - optional client instance to copy options and headers.
 *
 */
function Client(default_options) {

    // for options use prototype inheritance to create new object but with defaults
    var self = api_rpc.create_schema_client(api_schema, _.create(default_options));

    // TODO this is abusing this client as the signal_client for the rpc
    api_rpc.send_signal = self.node.send_signal;

    // the object client is a "heavy" object with caches
    self.object_client = new ObjectClient(self);

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

    return self;
}
