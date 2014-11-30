/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var fs = require('fs');
var http = require('http');
var path = require('path');
var util = require('util');
var repl = require('repl');
var assert = require('assert');
var crypto = require('crypto');
var mkdirp = require('mkdirp');
var Agent = require('./agent');
var api = require('../api');
var size_utils = require('../util/size_utils');
var argv = require('minimist')(process.argv);

Q.longStackSupport = true;

/**
 *
 * AgentCLI
 *
 * runs multiple agents in same process and provides CLI to list/start/stop/create etc.
 *
 * but might also be relevant for other environments that want to combine multiple agents.
 * when running local testing where it's easier to run all the agents inside the same process.
 *
 */
function AgentCLI() {
    var self = this;
    self.agents = {};
}


AgentCLI.prototype.load = function(params) {
    var self = this;

    if (!_.isEmpty(self.agents)) {
        throw new Error('cannot load while agents are started');
    }

    self.params = params;
    self.root_path = params.root_path || '.';
    self.auth_client = new api.auth_api.Client();
    self.auth_client.set_global_option('hostname', params.hostname || 'localhost');
    self.auth_client.set_global_option('port', params.port);

    return Q.fcall(function() {
            var auth_params = _.pick(self.params, 'email', 'password', 'system', 'role');
            if (self.params.tier) {
                auth_params.extra = {
                    tier: self.params.tier
                };
            }
            return self.auth_client.create_auth(auth_params);
        }).then(function(token) {
            self.auth_client.set_global_authorization(token);
            return Q.nfcall(mkdirp, self.root_path);
        })
        .then(function() {
            return Q.nfcall(fs.readdir, self.root_path);
        })
        .then(function(node_ids) {
            return Q.all(_.map(node_ids, function(node_id) {
                return self.start(node_id);
            }));
        }).then(function(res) {
            console.log('loaded', res.length, 'agents. show details with: nb.list()');
            return res;
        }, function(err) {
            console.error('load failed');
            throw err;
        }).thenResolve();
};

AgentCLI.prototype.list = function() {
    var self = this;

    _.each(self.agents, function(agent, node_id) {
        console.log(node_id, agent.is_started && 'started');
    });
};

AgentCLI.prototype.create = function(params) {
    var self = this;
    var node_id;
    var token;
    var node_path;
    var token_path;
    params = params || {};

    return Q.fcall(function() {
            if (params.node_id) return;
            var node_client = new api.node_api.Client();
            return node_client.create_node({
                name: '' + Date.now(),
                tier: params.tier || self.params.tier,
                geolocation: 'home',
                storage_alloc: size_utils.GB,
            });
        })
        .then(function(res) {
            node_id = params.node_id || res.id;
            token = params.token || res.token;
            if (!node_id || !token) {
                throw new Error('node_id & token must be provided');
            }
            node_path = path.join(self.root_path, node_id);
            token_path = path.join(node_path, 'token');
            return Q.all([
                file_must_not_exist(node_path),
                file_must_not_exist(token_path)
            ]);
        })
        .then(function() {
            return Q.nfcall(mkdirp, node_path);
        })
        .then(function() {
            return Q.nfcall(fs.writeFile, token_path, token);
        })
        .then(function() {
            return self.start(node_id);
        }).then(function(res) {
            console.log('created', node_id);
            return res;
        }, function(err) {
            console.error('create failed', node_id, err, err.stack);
            throw err;
        });
};

function file_must_not_exist(path) {
    return Q.nfcall(fs.stat, path)
        .then(function() {
            throw new Error('exists');
        }, function(err) {
            if (err.code !== 'ENOENT') throw err;
        });
}

function file_must_exist(path) {
    return Q.nfcall(fs.stat, path).thenResolve();
}

AgentCLI.prototype.start = function(node_id) {
    var self = this;
    var agent = self.agents[node_id];
    var node_path = path.join(self.root_path, node_id);
    var token_path = path.join(node_path, 'token');

    if (agent) {
        console.log('agent already started', node_id);
        return;
    }

    return Q.nfcall(fs.readFile, token_path)
        .then(function(token) {
            agent = self.agents[node_id] = new Agent({
                token: token,
                node_id: node_id,
                hostname: self.hostname,
                port: self.port,
                geolocation: 'home',
                storage_path: node_path,
            });
            return agent.start();
        }).then(function(res) {
            console.log('started', node_id);
            return res;
        }, function(err) {
            console.error('start failed', node_id, err);
            throw err;
        });
};

AgentCLI.prototype.stop = function(node_id) {
    var self = this;
    var agent = self.agents[node_id];

    if (!agent) {
        console.log('agent not started', node_id);
        return;
    }

    delete self.agents[node_id];
    agent.stop();
    console.log('stopped', node_id);
};



function main() {
    var cli = new AgentCLI();
    cli.load(argv).then(function() {
        // start a Read-Eval-Print-Loop
        var repl_srv = repl.start({
            prompt: 'agent_host > '
        });
        var help = 'try typing "nb." and then TAB ...';
        repl_srv.context.help = help;
        repl_srv.context.nb = cli;
    });
}

if (require.main === module) {
    main();
}
