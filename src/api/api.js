'use strict';

var _ = require('lodash');
var RPC = require('../rpc/rpc');
var RpcSchema = require('../rpc/rpc_schema');
var ObjectDriver = require('./object_driver');

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
api_schema.register_api(require('./stats_api'));
api_schema.register_api(require('./cloud_sync_api'));
api_schema.register_api(require('./debug_api'));
api_schema.register_api(require('./redirector_api'));
api_schema.register_api(require('./tiering_policy_api'));
api_schema.register_api(require('./pool_api'));
api_schema.register_api(require('./cluster_api'));
api_schema.compile();

function new_rpc(options) {
    options = options || {};
    options.schema = options.schema || api_schema;
    var rpc = new RPC(options);
    // abusing the default rpc client as the n2n_signaller for the rpc
    rpc.n2n_signaller = rpc.client.node.n2n_signal;
    // also abusing the default rpc client for the redirection
    rpc.redirection = rpc.client.redirector.redirect;
    return rpc;
}

var api_rpc = new_rpc();
var bg_workers_client = api_rpc.create_schema_client(api_schema, _.create({
    address: api_rpc.get_default_base_address('background')
}));


module.exports = {
    schema: api_schema,
    rpc: api_rpc,
    new_rpc: new_rpc,
    Client: Client,
    bg_workers_client: bg_workers_client
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

    self.object_driver_lazy = function() {
        // the object driver is a "heavy" object with caches
        if (!self.object_driver) {
            self.object_driver = new ObjectDriver(self);
        }
        return self.object_driver;
    };

    return self;
}
