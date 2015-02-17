'use strict';

var _ = require('lodash');
var Q = require('q');
var rest_api = require('../util/rest_api');
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

/**
 *
 * API FOLDER INDEX
 *
 */
module.exports = {

    // Client is a master client (like a master key) for all apis
    Client: Client,

    rest_api: rest_api,
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
function Client(base) {
    var self = this;

    // using prototype dependency on base options and headers
    rest_api.inherit_options_and_headers(self, base);

    self.auth = new auth_api.Client(self);
    self.account = new account_api.Client(self);
    self.system = new system_api.Client(self);
    self.tier = new tier_api.Client(self);
    self.node = new node_api.Client(self);
    self.agent = new agent_api.Client(self);
    self.bucket = new bucket_api.Client(self);
    self.object = new ObjectClient(self);

    /**
     * authenticate using the provided params,
     * and save the token in headers for next calls.
     */
    self.create_auth_token = function(params) {
        return self.auth.create_auth(params).then(function(res) {
            self.headers.set_auth_token(res.token);
            return res;
        });
    };

    /**
     * easy setup of account, system, tier, bucket
     */
    self.setup = function(params) {
        return Q.fcall(function() {
            return self.account.create_account({
                name: params.email,
                email: params.email,
                password: params.password,
            });
        }).then(function() {
            return self.create_auth_token({
                email: params.email,
                password: params.password,
            });
        }).then(function() {
            return self.system.create_system({
                name: params.system,
            });
        }).then(function() {
            return self.create_auth_token({
                system: params.system,
            });
        }).then(function() {
            return self.tier.create_tier({
                name: params.tier,
                kind: 'edge',
            });
        }).then(function() {
            return self.bucket.create_bucket({
                name: params.bucket,
                tiering: [params.tier]
            });
        });
    };

}
