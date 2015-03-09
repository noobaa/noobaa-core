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
var config = require('../../config.js');
var DebugModule = require('noobaa-util/debug_module');

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
        address: params.prod ? config.web_address_heroku : config.web_address,
        port: params.prod ? 5050 : 0,
        email: 'demo@noobaa.com',
        password: 'DeMo',
        system: 'demo@noobaa.com',
        tier: 'nodes',
        bucket: 'files'
    });
    self.client = new api.Client();
    self.client.options.set_address(self.params.address);
    self.agents = {};
    self._mod = new DebugModule(__filename);
    self.modules = self._mod.get_module_structure();
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
        var account_params = _.pick(self.params, 'email', 'password');
        account_params.name = account_params.email;
        return self.client.account.create_account(account_params)
            .then(function() {
                console.log('COMPLETED: setup', self.params);
            }, function(err) {
                console.log('ERROR: setup', self.params, err.stack);
            })
            .then(function() {
                process.exit();
            });
    }

    return self.load()
        .then(function() {
            console.log('COMPLETED: load');
        }, function(err) {
            console.log('ERROR: load', self.params, err.stack);

        });
};

try {
    setInterval(function() {
        console.log(
            'memory ' + JSON.stringify(process.memoryUsage()));
    }, 30000);
} catch (ex) {
    console.error("prob xxxxxxx");
}

AgentCLI.prototype.init.helper = function() {
    console.log("Init client");
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
            console.error('load failed ' + err.stack);
            throw err;
        });
};

AgentCLI.prototype.load.helper = function() {
    console.log("create token, start nodes ");
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
            if (self.create_node_token) return;
            // authenticate and create a token for new nodes
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
            if (res) {
                self.create_node_token = res.token;
            }
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

AgentCLI.prototype.create.helper = function() {
    console.log("Create a new agent and start it");
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

AgentCLI.prototype.create_some.helper = function() {
    console.log("Create n agents:   create_some <n>");
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
            storage_path: path.join(self.params.root_path, node_name)
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

AgentCLI.prototype.start.helper = function() {
    console.log("Start a specific agent, if agent doesn't exist, will create it:   start <agent>");
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

AgentCLI.prototype.stop.helper = function() {
    console.log("Stop a specific agent:   stop <agent>");
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

AgentCLI.prototype.list.helper = function() {
    console.log("List all agents status");
};

/**
 *
 * Set Log Level
 *
 * Set logging level for a module
 *
 */
AgentCLI.prototype.set_log = function(mod, level) {
    var self = this;
    self._mod.set_level(level, mod);
    console.log("Log for " + mod + " with level of " + level + " was set");

};

AgentCLI.prototype.set_log.helper = function() {
    console.log('Setting log levels for module:   set_log <"module"> <level>');
};
/**
 *
 * Show
 *
 * help for specific API
 *
 */

AgentCLI.prototype.show = function(func_name) {
    var func = this[func_name];
    var helper = func && func.helper;

    // in the common case the helper is a function - so call it
    if (typeof(helper) === 'function') {
        return helper.call(this);
    }

    // if helper is string or something else we just print it
    if (helper) {
        console.log(helper);
    } else {
        console.log('help not found for function', func_name);
    }
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

function populate_general_help(general) {
    general.push('show("<function>"") to show help on a specific API');
}

function main() {

    var cli = new AgentCLI(argv);
    cli.init().done(function() {
        // start a Read-Eval-Print-Loop
        var repl_srv = repl.start({
            prompt: 'agent-cli > ',
            useGlobal: false
        });
        var help = {
            functions: [],
            variables: [],
            general: [],
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
        populate_general_help(help.general);
        repl_srv.context.help = help;
    }, function(err) {
        console.error(err);
    });
}

if (require.main === module) {
    main();
}


process.stdin.resume(); //so the program will not close instantly

function exitHandler() {
    console.log('exiting');
    process.exit();
}

process.on('exit', function(code) {
    console.log('About to exit with code:', code);
});

process.on('uncaughtException', function(err) {
    console.log('Caught exception: ' + err + ' ; ' + err.stack);
    //exitHandler();
});
