/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var fs = require('fs');
var os = require('os');
var http = require('http');
var path = require('path');
var util = require('util');
var repl = require('repl');
var assert = require('assert');
var crypto = require('crypto');
var mkdirp = require('mkdirp');
var argv = require('minimist')(process.argv);
var Semaphore = require('noobaa-util/semaphore');
var size_utils = require('../util/size_utils');
var api = require('../api');
var Agent = require('./agent');

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
function AgentCLI(params) {
    var self = this;
    self.params = _.defaults(params, {
        root_path: './agent_storage/',
        address: params.prod ? 'https://noobaa-core.herokuapp.com' : 'http://localhost:5001',
        port: params.prod ? 5050 : 0,
        email: 'demo@noobaa.com',
        password: 'DeMo',
        system: 'demo',
        tier: 'nodes',
        bucket: 'files',
    });
    self.client = new api.Client();
    self.client.options.set_address(self.params.address);
    self.agents = {};
}


/**
 *
 * INIT
 *
 *
 *
 */
AgentCLI.prototype.init = function() {
    var self = this;

    if (self.params.setup) {
        return self.client.setup(self.params)
            .then(function() {
                console.log('COMPLETED: setup', self.params);
            }, function(err) {
                console.log('ERROR: setup', self.params, err);
            })
            .then(function() {
                process.exit();
            });
    }

    return self.load()
        .then(function() {
            console.log('COMPLETED: load');
        }, function(err) {
            console.log('ERROR: load', self.params, err);

        });
};



/**
 *
 * LOAD
 *
 * create account, system, tier, bucket.
 *
 */
AgentCLI.prototype.load = function() {
    var self = this;

    return Q.fcall(function() {
            var auth_params = _.pick(self.params,
                'email', 'password', 'system', 'role');
            if (self.params.tier) {
                auth_params.extra = {
                    tier: self.params.tier
                };
            }
            return self.client.create_auth_token(auth_params);
        })
        .then(function(res) {
            self.create_node_token = res.token;
            return Q.nfcall(mkdirp, self.params.root_path);
        })
        .then(function() {
            return Q.nfcall(fs.readdir, self.params.root_path);
        })
        .then(function(names) {
            return Q.all(_.map(names, function(node_name) {
                return self.start(node_name);
            }));
        })
        .then(function(res) {
            console.log('loaded', res.length, 'agents. show details with: list()');
            if (self.params.prod && !res.length) {
                return self.create();
            }
        })
        .then(null, function(err) {
            console.error('load failed');
            throw err;
        });
};



/**
 *
 * CREATE
 *
 * create new node agent
 *
 */
AgentCLI.prototype.create = function() {
    var self = this;

    var node_name = os.hostname() + '-' + Date.now();
    var node_path = path.join(self.params.root_path, node_name);
    var token_path = path.join(node_path, 'token');

    return file_must_not_exist(token_path)
        .then(function() {
            return Q.nfcall(mkdirp, node_path);
        })
        .then(function() {
            return Q.nfcall(fs.writeFile, token_path, self.create_node_token);
        })
        .then(function() {
            return self.start(node_name);
        }).then(function(res) {
            console.log('created', node_name);
            return res;
        }, function(err) {
            console.error('create failed', node_name, err, err.stack);
            throw err;
        });
};


/**
 *
 * CREATE_SOME
 *
 * create new node agent
 *
 */
AgentCLI.prototype.create_some = function(n) {
    var self = this;
    var sem = new Semaphore(5);
    return Q.all(_.times(n, function() {
        return sem.surround(function() {
            return self.create();
        });
    }));
};



/**
 *
 * START
 *
 * start agent
 *
 */
AgentCLI.prototype.start = function(node_name) {
    var self = this;

    var agent = self.agents[node_name];
    if (!agent) {
        agent = self.agents[node_name] = new Agent({
            address: self.params.address,
            node_name: node_name,
            prefered_port: self.params.port,
            storage_path: path.join(self.params.root_path, node_name),
        });
        console.log('agent inited', node_name);
    }

    return Q.fcall(function() {
        return agent.start();
    }).then(function(res) {
        console.log('agent started', node_name);
        return res;
    }, function(err) {
        console.error('FAILED TO START AGENT', node_name, err);
        throw err;
    });
};



/**
 *
 * STOP
 *
 * stop agent
 *
 */
AgentCLI.prototype.stop = function(node_name) {
    var self = this;

    var agent = self.agents[node_name];
    if (!agent) {
        console.log('agent not found', node_name);
        return;
    }

    agent.stop();
    console.log('agent stopped', node_name);
};



/**
 *
 * LIST
 *
 * list agents status
 *
 */
AgentCLI.prototype.list = function() {
    var self = this;

    var i = 1;
    _.each(self.agents, function(agent, node_name) {
        console.log('#' + i, agent.is_started ? '<ok>' : '<STOPPED>',
            'node', node_name, 'port', agent.http_port);
        i++;
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


function main() {
    var cli = new AgentCLI(argv);
    cli.init().done(function() {
        // start a Read-Eval-Print-Loop
        var repl_srv = repl.start({
            prompt: 'agent-cli > ',
            useGlobal: false,
        });
        var help = {
            functions: [],
            variables: [],
        };
        _.forIn(cli, function(val, key) {
            if (typeof(val) === 'function') {
                repl_srv.context[key] = val.bind(cli);
                help.functions.push(key);
            } else {
                repl_srv.context[key] = val;
                help.variables.push(key);
            }
        });
        repl_srv.context.help = help;
    }, function(err) {
        console.error(err);
    });
}

if (require.main === module) {
    main();
}
