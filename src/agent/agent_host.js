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
var Q = require('q');
var LRU = require('noobaa-util/lru');
var agent_host_api = require('../api/agent_host_api');
var Agent = require('./agent');
var size_utils = require('../util/size_utils');
var account_api = require('../api/account_api');
var edge_node_api = require('../api/edge_node_api');
var agent_api = require('../api/agent_api');
var express_morgan_logger = require('morgan');
var express_body_parser = require('body-parser');
var express_method_override = require('method-override');
var express_compress = require('compression');

module.exports = AgentHost;

/**
 * AgentHost allows running multiple agents and provides api to start/stop/status each one.
 *
 * used for local testing where it's easier to run all the agents inside the same process,
 * but might also be relevant for other environments that want to combine multiple agents.
 */
function AgentHost(params) {
    var self = this;

    params = params || {};

    // node_vendor_id is an optional id of NodeVendor (db model)
    // if supplied it should have a kind:'agent-host'.
    self.node_vendor_id = params.node_vendor_id;
    self.hostname = params.hostname;
    self.port = params.port || 5002;

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
    self.agent_host_server.set_logging();
    self.agent_host_server.install_routes(app, '/api/agent_host_api/');

    self.agents = {};
    self.agent_storage_dir = path.resolve(__dirname, '../../local_agent_storage/host');
    self.account_client = new account_api.Client({
        path: '/account_api/',
    });
    self.edge_node_client = new edge_node_api.Client({
        path: '/edge_node_api/',
    });

    // start http server
    self.server = http.createServer(app);
    self.server.listen(self.port, function() {
        console.log('Web server on port ' + self.port);
        self.connect_node_vendor();
    });
}


AgentHost.prototype.connect_node_vendor = function() {
    var self = this;
    return Q.when(self.edge_node_client.connect_node_vendor({
        id: self.node_vendor_id,
        kind: 'agent-host',
        info: {
            hostname: self.hostname,
            port: self.port,
        }
    })).then(
        function(vendor) {
            if (vendor.id !== self.node_vendor_id) {
                self.node_vendor_id = vendor.id;
                // TODO save id to file
            }
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
    var account_credentials = req.param('account_credentials');
    return Q.when(self.stop_agent(req)).then(
        function() {
            var agent = self.agents[node_name] = new Agent({
                account_client: self.account_client,
                edge_node_client: self.edge_node_client,
                account_credentials: account_credentials,
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
    main_host_instance = new AgentHost();
}

if (require.main === module) {
    host_main();
}
