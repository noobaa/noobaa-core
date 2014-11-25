/* jshint node:true */
'use strict';

var _ = require('lodash');
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var http = require('http');
var mkdirp = require('mkdirp');
var express = require('express');
var mkdirp = require('mkdirp');
var Q = require('q');
var LRU = require('noobaa-util/lru');
var agent_host_api = require('../api/agent_host_api');
var Agent = require('./agent');
var size_utils = require('../util/size_utils');
var account_api = require('../api/account_api');
var node_api = require('../api/node_api');
var agent_api = require('../api/agent_api');
var express_morgan_logger = require('morgan');
var express_body_parser = require('body-parser');
var express_method_override = require('method-override');
var express_compress = require('compression');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

module.exports = AgentHost;

util.inherits(AgentHost, EventEmitter);

/**
 * AgentHost allows running multiple agents and provides api to start/stop/status each one.
 *
 * used for local testing where it's easier to run all the agents inside the same process,
 * but might also be relevant for other environments that want to combine multiple agents.
 */
function AgentHost(params) {
    var self = this;

    params = params || {};
    assert(params.agent_storage_dir, 'missing agent_storage_dir');
    assert(params.name, 'missing name');
    assert(params.port, 'missing port');
    self.agent_storage_dir = params.agent_storage_dir;
    self.name = params.name;
    self.hostname = params.hostname;
    self.port = params.port;
    // client_params and account_credentials are used to access the apis
    assert(params.account_credentials, 'missing account_credentials');
    self.client_params = params.client_params;
    self.account_credentials = params.account_credentials;

    // create express app
    var app = self.app = express();
    app.set('port', self.port);

    app.use(express_morgan_logger('combined'));
    app.use(express_body_parser.json());
    app.use(express_body_parser.raw());
    app.use(express_body_parser.text());
    app.use(express_body_parser.urlencoded({
        extended: false
    }));
    app.use(express_method_override());
    app.use(express_compress());


    self.agent_host_server = new agent_host_api.Server({
        get_agent_status: self.get_agent_status.bind(self),
        start_agent: self.start_agent.bind(self),
        stop_agent: self.stop_agent.bind(self),
    });
    self.agent_host_server.install_rest(app, '/api/agent_host_api/');

    self.agents = {};
    self.account_client = new account_api.Client(self.client_params);
    self.node_client = new node_api.Client(self.client_params);

    // start http server
    self.server = http.createServer(app);
    self.server.listen(self.port, function() {
        console.log('Web server on port ' + self.port);
        self.connect_node_vendor();
    });
}


AgentHost.prototype.connect_node_vendor = function() {
    var self = this;
    return Q.fcall(
        function() {
            console.log('login_account', self.account_credentials.email);
            return self.account_client.login_account(self.account_credentials);
        }
    ).then(
        function() {
            var params = {
                name: self.name,
                kind: 'agent_host',
                info: {
                    hostname: self.hostname,
                    port: self.port,
                }
            };
            console.log('connect_node_vendor', params);
            return self.node_client.connect_node_vendor(params);
        }
    ).then(
        function(vendor) {
            console.log('connected node vendor', vendor);
        }
    );
};


AgentHost.prototype.get_agent_status = function(req) {
    var self = this;
    var node_name = req.param('name');
    var agent = self.agents[node_name];
    var status = false;
    if (agent && agent.is_started) {
        status = true;
    }
    return {
        status: status
    };
};


AgentHost.prototype.start_agent = function(req) {
    var self = this;
    var node_name = req.param('name');
    var geolocation = req.param('geolocation');
    return Q.when(self.stop_agent(req)).then(
        function() {
            var agent = self.agents[node_name] = new Agent({
                account_client: self.account_client,
                node_client: self.node_client,
                account_credentials: self.account_credentials,
                node_name: node_name,
                node_geolocation: geolocation,
                storage_path: self.agent_storage_dir,
            });
            return agent.start();
        }
    ).thenResolve();
};


AgentHost.prototype.stop_agent = function(req) {
    var self = this;
    var node_name = req.param('name');
    var agent = self.agents[node_name];
    delete self.agents[node_name];
    return Q.fcall(
        function() {
            if (!agent) {
                return;
            }
            return agent.stop();
        }
    ).thenResolve();
};


// run as main script

var main_host_instance;

function host_main() {
    var host_dir = path.resolve(__dirname, '../../test_data/agent_host');
    mkdirp.sync(host_dir);
    var host_config_file = path.join(host_dir, 'config.json');
    var load_config = function() {
        try {
            var config = JSON.parse(fs.readFileSync(host_config_file));
            console.log('loaded config', config);
            return config;
        } catch (err) {
            console.log('no config. new vendor will be created');
        }
    };
    var save_config = function(config) {
        try {
            console.log('saving config', config);
            return fs.writeFileSync(host_config_file, JSON.stringify(config));
        } catch (err) {
            console.error('FAILED SAVE CONFIG');
        }
    };
    var host_config = load_config() || {};
    // extend the config with defaults
    var params = _.merge({}, {
        agent_storage_dir: host_dir,
        name: 'Guy MAC Host',
        hostname: 'localhost',
        port: 5002,
        client_params: {
            hostname: 'localhost',
            port: 5001
        },
        account_credentials: {
            email: 'a@a.a',
            password: 'aaa',
        },
    }, host_config);
    main_host_instance = new AgentHost(params);
}

if (require.main === module) {
    host_main();
}
