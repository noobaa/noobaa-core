/* jshint node:true */
'use strict';
require('../util/panic');

var _ = require('lodash');
var P = require('../util/promise');
var fs = require('fs');
var os = require('os');
var path = require('path');
var util = require('util');
var repl = require('repl');
var mkdirp = require('mkdirp');
var argv = require('minimist')(process.argv);
var Semaphore = require('../util/semaphore');
var api = require('../api');
var Agent = require('./agent');
var fs_utils = require('../util/fs_utils');
var promise_utils = require('../util/promise_utils');
// var config = require('../../config.js');
var dbg = require('../util/debug_module')(__filename);
var child_process = require('child_process');
var s3_auth = require('aws-sdk/lib/signers/s3');
var uuid = require('node-uuid');

setInterval(function() {
    dbg.log0('memory usage', process.memoryUsage());
}, 30000);

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
    this.params = params;
    this.client = new api.Client();
    this.s3 = new s3_auth();
    this.agents = {};
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

    return P.nfcall(fs.readFile, 'agent_conf.json')
        .then(function(data) {
            var agent_conf = JSON.parse(data);
            dbg.log0('using agent_conf.json', util.inspect(agent_conf));
            _.defaults(self.params, agent_conf);
        })
        .then(null, function(err) {
            dbg.log0('cannot find configuration file. Using defaults.', err);
        })
        .then(function() {
            _.defaults(self.params, {
                root_path: './agent_storage/',
                access_key: '123',
                secret_key: 'abc',
                system: 'demo',
                tier: 'nodes',
                bucket: 'files'
            });
            if (self.params.address) {
                self.client.options.address = self.params.address;
            }

            if (self.params.setup) {
                dbg.log0('Setup');
                var account_params = _.pick(self.params, 'email', 'password');
                account_params.name = account_params.email;
                return self.client.account.create_account(account_params)
                    .then(function() {
                        dbg.log0('COMPLETED: setup', self.params);
                    }, function(err) {
                        dbg.log0('ERROR: setup', self.params, err.stack);
                    })
                    .then(function() {
                        process.exit();
                    });
            }
        }).then(function() {

            return self.load()
                .then(function() {
                    dbg.log0('COMPLETED: load');
                }, function(err) {
                    dbg.error('ERROR: load', self.params, err.stack);
                    throw new Error(err);
                });
        });
};

AgentCLI.prototype.init.helper = function() {
    dbg.log0("Init client");
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

    return P.fcall(function() {
            return P.nfcall(mkdirp, self.params.root_path);
        })
        .then(function() {
            return self.hide_storage_folder();
        })
        .then(null, function(err) {
            dbg.error('Windows - failed to hide', err.stack || err);
            // TODO really continue on error?
        })
        .then(function() {
            dbg.log0('root_path', self.params.root_path);
            return P.nfcall(fs.readdir, self.params.root_path);
        })
        .then(function(names) {
            return P.all(_.map(names, function(node_name) {
                return self.start(node_name);
            }));
        })
        .then(function(res) {
            dbg.log0('loaded ', res.length, 'agents. show details with: list()');
            if (self.params.prod && !res.length) {
                return self.create();
            }
        })
        .then(null, function(err) {
            dbg.log0('load failed ' + err.stack);
            throw err;
        });
};

AgentCLI.prototype.hide_storage_folder = function() {
    var self = this;
    dbg.log0('os:', os.type());
    if (os.type().indexOf('Windows') >= 0) {
        var current_path = self.params.root_path;
        current_path = current_path.substring(0, current_path.length - 1);
        current_path = current_path.replace('./', '');

        //hiding storage folder
        return P.nfcall(child_process.exec, 'attrib +H ' + current_path)
            .then(function() {
                //Setting system full permissions and remove builtin users permissions.
                //TODO: remove other users
                return P.nfcall(child_process.exec,
                    'icacls ' + current_path +
                    ' /t' +
                    ' /grant:r administrators:(oi)(ci)F' +
                    ' /grant:r system:F' +
                    ' /remove:g BUILTIN\\Users' +
                    ' /inheritance:r');
            });
    }
};

AgentCLI.prototype.load.helper = function() {
    dbg.log0("create token, start nodes ");
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

    var node_name = os.hostname() + '-' + uuid();
    var node_path = path.join(self.params.root_path, node_name);
    var token_path = path.join(node_path, 'token');
    dbg.log0('create new node');
    return fs_utils.file_must_not_exist(token_path)
        .then(function() {
            if (self.create_node_token) return;
            // authenticate and create a token for new nodes

            var basic_auth_params = _.pick(self.params,
                'system', 'role');
            if (_.isEmpty(basic_auth_params)) {
                throw new Error("No credentials");
            } else {
                var secret_key = self.params.secret_key;
                var auth_params_str = JSON.stringify(basic_auth_params);
                var signature = self.s3.sign(secret_key, auth_params_str);
                var auth_params = {
                    access_key: self.params.access_key,
                    string_to_sign: auth_params_str,
                    signature: signature
                };
                if (self.params.tier) {
                    auth_params.extra = {
                        tier: self.params.tier
                    };
                }
                return self.client.create_access_key_auth(auth_params);
            }
        })
        .then(function(res) {
            if (res) {
                dbg.log0('result create:', res);
                self.create_node_token = res.token;
            } else {
                dbg.log0('has token', self.create_node_token);
            }
            return P.nfcall(mkdirp, node_path);
        }).then(function() {
            return P.nfcall(fs.writeFile, token_path, self.create_node_token);
        })
        .then(function() {
            return self.start(node_name);
        }).then(function(res) {
            dbg.log0('created', node_name);
            return res;
        }, function(err) {
            dbg.log0('create failed', node_name, err, err.stack);
            throw err;
        });
};

AgentCLI.prototype.create.helper = function() {
    dbg.log0("Create a new agent and start it");
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
    return P.all(_.times(n, function() {
        return sem.surround(function() {
            return self.create();
        });
    }));
};

AgentCLI.prototype.create_some.helper = function() {
    dbg.log0("Create n agents:   create_some <n>");
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
            storage_path: path.join(self.params.root_path, node_name),
        });
        dbg.log0('agent inited', node_name, self.params.addres, self.params.port, self.params.secure_port);
    }

    return P.fcall(function() {
        return promise_utils.retry(100, 1000, 1000, agent.start.bind(agent));
    }).then(function(res) {
        dbg.log0('agent started', node_name);
        return res;
    }, function(err) {
        dbg.log0('FAILED TO START AGENT', node_name, err);
        throw err;
    });
};

AgentCLI.prototype.start.helper = function() {
    dbg.log0("Start a specific agent, if agent doesn't exist, will create it:   start <agent>");
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
        dbg.log0('agent not found', node_name);
        return;
    }

    agent.stop();
    dbg.log0('agent stopped', node_name);
};

AgentCLI.prototype.stop.helper = function() {
    dbg.log0("Stop a specific agent:   stop <agent>");
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
        dbg.log0('#' + i, agent.is_started ? '<ok>' : '<STOPPED>',
            'node', node_name, 'port', agent.http_port);
        i++;
    });
};

AgentCLI.prototype.list.helper = function() {
    dbg.log0("List all agents status");
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
        dbg.log0(helper);
    } else {
        dbg.log0('help not found for function', func_name);
    }
};

function populate_general_help(general) {
    general.push('show("<function>"") to show help on a specific API');
}

function main() {

    var cli = new AgentCLI(argv);
    cli.init().done(function() {
        if (argv.norepl) return;
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
        repl_srv.context.dbg = dbg;
    }, function(err) {
        dbg.error('init err:' + err);
    });
}

if (require.main === module) {
    main();
}
