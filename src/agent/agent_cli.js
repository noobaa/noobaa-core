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
var DebugModule = require('noobaa-util/debug_module')(__filename);

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
        email: 'yossi@ness.com',
        password: 'yossi',
        system: 'ness',
        tier: 'nodes',
        bucket: 'files'
    });
    self.client = new api.Client();
    self.client.options.set_address(self.params.address);
    self.agents = {};


    //self._mod = new DebugModule(__filename);
    //self.modules = self._mod.get_module_structure();
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
    var agent_conf;
    return Q.nfcall(fs.readFile, 'agent.conf', 'utf8')
        .then(function(data) {
            agent_conf = JSON.parse(data);
            self.params.prod = true;
            self.params.web_address_heroku = agent_conf.noobaa_address;
            //self.params.create_node_token = agent_conf.noobaa_access_key;
            self.params.address = agent_conf.noobaa_address;
            self.params.email = agent_conf.email;
            self.params.password = agent_conf.password;
            self.params.system = agent_conf.system;
            self.params.tier = agent_conf.tier;
            self.params.bucket = agent_conf.bucket;
            DebugModule.log0('agent_conf', agent_conf);
            return;
        }, function(err) {
            DebugModule.log0('cannot find configuration file. Using defaults.');
        })
        .then(function() {
            if (self.params.setup) {
                DebugModule.log0('Setup');
                var account_params = _.pick(self.params, 'email', 'password');
                account_params.name = account_params.email;
                return self.client.account.create_account(account_params)
                    .then(function() {
                        DebugModule.log0('COMPLETED: setup', self.params);
                    }, function(err) {
                        DebugModule.log0('ERROR: setup', self.params, err.stack);
                    })
                    .then(function() {
                        process.exit();
                    });
            }
        }).then(function() {

            return self.load()
                .then(function() {
                    DebugModule.log0('COMPLETED: load');
                }, function(err) {
                    DebugModule.log0('ERROR: load', self.params, err.stack);

                });
        });
};

try {
    setInterval(function() {
        DebugModule.log0(
            'memory ' + JSON.stringify(process.memoryUsage()));
    }, 30000);
} catch (ex) {
    DebugModule.log0("prob xxxxxxx");
}

AgentCLI.prototype.init.helper = function() {
    DebugModule.log0("Init client");
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
            DebugModule.log0('os:', os.type());
            if (typeof process !== 'undefined' &&
                process.versions &&
                process.versions['atom-shell']) {
                try {
                    require('fswin').setAttributesSync(self.params.root_path, {
                        IS_HIDDEN: true
                    });
                    DebugModule.log0('Windows - hide1');

                } catch (err) {
                    DebugModule.log0('Windows - hide failed ', err);

                }
            }
            if (os.type().indexOf('Windows') > 0) {
                try {
                    require('fswin').setAttributesSync(self.params.root_path, {
                        IS_HIDDEN: true
                    });
                    DebugModule.log0('Windows - hide');

                } catch (err) {
                    DebugModule.log0('Windows - hide2 failed ', err);

                }

            }
            return Q.nfcall(fs.readdir, self.params.root_path);
        })
        .then(function(names) {
            return Q.all(_.map(names, function(node_name) {
                return self.start(node_name);
            }));
        })
        .then(function(res) {
            DebugModule.log0('loaded', res.length, 'agents. show details with: list()');
            if (self.params.prod && !res.length) {
                return self.create();
            }
        })
        .then(null, function(err) {
            DebugModule.log0('load failed ' + err.stack);
            throw err;
        });
};

AgentCLI.prototype.load.helper = function() {
    DebugModule.log0("create token, start nodes ");
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
    DebugModule.log0('create new node');
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
                DebugModule.log0('eee:', res);
                self.create_node_token = res.token;
            } else {
                DebugModule.log0('has token', self.create_node_token);
            }
            return Q.nfcall(fs.writeFile, token_path, self.create_node_token);
        })
        .then(function() {
            return self.start(node_name);
        }).then(function(res) {
            DebugModule.log0('created', node_name);
            return res;
        }, function(err) {
            DebugModule.log0('create failed', node_name, err, err.stack);
            throw err;
        });
};

AgentCLI.prototype.create.helper = function() {
    DebugModule.log0("Create a new agent and start it");
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
    DebugModule.log0("Create n agents:   create_some <n>");
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
        DebugModule.log0('agent inited', node_name);
    }

    return Q.fcall(function() {
        return agent.start();
    }).then(function(res) {
        DebugModule.log0('agent started', node_name);
        return res;
    }, function(err) {
        DebugModule.log0('FAILED TO START AGENT', node_name, err);
        throw err;
    });
};

AgentCLI.prototype.start.helper = function() {
    DebugModule.log0("Start a specific agent, if agent doesn't exist, will create it:   start <agent>");
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
        DebugModule.log0('agent not found', node_name);
        return;
    }

    agent.stop();
    DebugModule.log0('agent stopped', node_name);
};

AgentCLI.prototype.stop.helper = function() {
    DebugModule.log0("Stop a specific agent:   stop <agent>");
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
        DebugModule.log0('#' + i, agent.is_started ? '<ok>' : '<STOPPED>',
            'node', node_name, 'port', agent.http_port);
        i++;
    });
};

AgentCLI.prototype.list.helper = function() {
    DebugModule.log0("List all agents status");
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
    DebugModule.log0("Log for " + mod + " with level of " + level + " was set");

};

AgentCLI.prototype.set_log.helper = function() {
    DebugModule.log0('Setting log levels for module:   set_log <"module"> <level>');
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
        DebugModule.log0(helper);
    } else {
        DebugModule.log0('help not found for function', func_name);
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
        DebugModule.log0(err);
    });
}

if (require.main === module) {
    main();
}


process.stdin.resume(); //so the program will not close instantly

function exitHandler() {
    DebugModule.log0('exiting');
    process.exit();
}

process.on('exit', function(code) {
    DebugModule.log0('About to exit with code:', code);
});

process.on('uncaughtException', function(err) {
    DebugModule.log0('Caught exception: ' + err + ' ; ' + err.stack);
    //exitHandler();
});
