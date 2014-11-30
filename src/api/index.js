'use strict';

var _ = require('lodash');
var rest_api = require('../util/rest_api');
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
    // using prototype dependency on base
    self.options = base && base.options && Object.create(base.options) || {};
    self.headers = base && base.headers && Object.create(base.headers) || {};

    self.auth = new auth_api.Client(self.options, self.headers);
    self.account = new account_api.Client(self.options, self.headers);
    self.system = new system_api.Client(self.options, self.headers);
    self.tier = new tier_api.Client(self.options, self.headers);
    self.node = new node_api.Client(self.options, self.headers);
    self.bucket = new bucket_api.Client(self.options, self.headers);
    self.object = new ObjectClient(self.options, self.headers);
    self.agent = new agent_api.Client(self.options, self.headers);

    // helper functions to set options and headers

    self.set_option = function(key, val) {
        self.options[key] = val;
    };
    self.clear_option = function(key) {
        delete self.options[key];
    };
    self.set_header = function(key, val) {
        self.headers[key] = val;
    };
    self.clear_header = function(key) {
        delete self.headers[key];
    };
    self.set_auth_token = function(token) {
        self.token = token;
        rest_api.set_auth_header(token, self.headers);
    };
    self.create_auth_token = function(params) {
        return self.auth.create_auth(params).then(function(res) {
            self.set_auth_token(res.token);
            return res.token;
        });
    };
}
