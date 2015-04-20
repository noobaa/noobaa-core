'use strict';

var _ = require('lodash');
var Q = require('q');
var common_api = require('./common_api');
var auth_api = require('./auth_api');
var account_api = require('./account_api');
var system_api = require('./system_api');
var tier_api = require('./tier_api');
var node_api = require('./node_api');
var bucket_api = require('./bucket_api');
var object_api = require('./object_api');
var ObjectClient = require('./object_client');
var agent_api = require('./agent_api');
var RPC = require('../rpc/rpc');


// the api defines one global rpc instance.
// (multiple rpc instances are used for testing).
var rpc = new RPC();
rpc.register_api(common_api);
rpc.register_api(auth_api);
rpc.register_api(account_api);
rpc.register_api(system_api);
rpc.register_api(tier_api);
rpc.register_api(node_api);
rpc.register_api(bucket_api);
rpc.register_api(object_api);
rpc.register_api(agent_api);


/**
 *
 * API FOLDER INDEX
 *
 */
module.exports = {

    // the api rpc instance
    rpc: rpc,

    // Client is a master client (like a master key) for all apis
    Client: Client,

    common_api: common_api,
    auth_api: auth_api,
    account_api: account_api,
    system_api: system_api,
    tier_api: tier_api,
    node_api: node_api,
    bucket_api: bucket_api,
    object_api: object_api,
    ObjectClient: ObjectClient,
    agent_api: agent_api,
};


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

    self.options.p2p_context = self.options.p2p_context || {};

    self.auth = rpc.create_client('auth_api', self.options);
    self.account = rpc.create_client('account_api', self.options);
    self.system = rpc.create_client('system_api', self.options);
    self.tier = rpc.create_client('tier_api', self.options);
    self.node = rpc.create_client('node_api', self.options);
    self.agent = rpc.create_client('agent_api', self.options);
    self.bucket = rpc.create_client('bucket_api', self.options);
    self.object = rpc.create_client('object_api', self.options);
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
