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
var Agent = require('./agent');
var api = require('../api');
var size_utils = require('../util/size_utils');
var argv = require('minimist')(process.argv);
var Semaphore = require('noobaa-util/semaphore');

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
        email: 'a@a.a',
        password: 'aaa',
        system: 'sys',
        tier: 'tier',
        bucket: 'bucket',
    });
    self.root_path = self.params.root_path || '.';
    self.client = new api.Client();
    self.client.options.set_host(self.params.hostname, self.params.port);
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

    return Q.fcall(function() {
            if (self.params.setup) {
                return self.setup();
            }
        })
        .then(function() {
            return self.load();
        });
};



/**
 *
 * SETUP
 *
 * create account, system, tier, bucket.
 *
 */
AgentCLI.prototype.setup = function() {
    var self = this;
    var p = self.params;
    console.log(p);

    return Q.fcall(function() {
        return self.client.account.create_account({
            name: p.email,
            email: p.email,
            password: p.password,
        });
    }).then(function() {
        return self.client.create_auth_token({
            email: p.email,
            password: p.password,
        });
    }).then(function() {
        return self.client.system.create_system({
            name: p.system,
        });
    }).then(function() {
        return self.client.create_auth_token({
            system: p.system,
        });
    }).then(function(token) {
        return self.client.tier.create_tier({
            name: p.tier,
            kind: 'edge',
            edge_details: {
                replicas: 2,
                data_fragments: 200,
                parity_fragments: 100,
            }
        });
    }).then(function() {
        return self.client.bucket.create_bucket({
            name: p.bucket,
        });
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
        }).then(function(token) {
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



/**
 *
 * CREATE
 *
 * create new node agent
 *
 */
AgentCLI.prototype.create = function() {
    var self = this;

    // TODO can we make more relevant dir name?
    var node_name = os.hostname() + '-' + Date.now();
    var node_path = path.join(self.root_path, node_name);
    var token_path = path.join(node_path, 'token');

    return Q.all([
            file_must_not_exist(node_path),
            file_must_not_exist(token_path)
        ])
        .then(function() {
            return Q.nfcall(mkdirp, node_path);
        })
        .then(function() {
            return Q.nfcall(fs.writeFile, token_path, self.client.token);
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
    var node_path = path.join(self.root_path, node_name);
    var token_path = path.join(node_path, 'token');

    if (agent) {
        console.log('agent already started', node_name);
        return;
    }

    return Q.fcall(function() {
        agent = self.agents[node_name] = new Agent({
            hostname: self.params.hostname,
            port: self.params.port,
            node_name: node_name,
            storage_path: node_path,
        });
        return agent.start();
    }).then(function(res) {
        console.log('started', node_name);
        return res;
    }, function(err) {
        console.error('start failed', node_name, err);
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



/**
 *
 * LIST
 *
 * list agents status
 *
 */
AgentCLI.prototype.list = function() {
    var self = this;

    _.each(self.agents, function(agent, node_id) {
        console.log(node_id, agent.is_started && 'started');
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
            prompt: 'agent-cli > '
        });
        var help = 'try typing "nb." and then TAB ...';
        repl_srv.context.help = help;
        repl_srv.context.nb = cli;
    });
}

if (require.main === module) {
    main();
}
