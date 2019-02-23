/* Copyright (C) 2016 NooBaa */
'use strict';

var dotenv = require('../util/dotenv');
dotenv.load();

var _ = require('lodash');
var repl = require('repl');
var util = require('util');
var api = require('../api');
var P = require('../util/promise');
var argv = require('minimist')(process.argv);

var repl_srv;
var rpcshell = new RPCShell();

argv.email = argv.email || 'demo@noobaa.com';
argv.password = argv.password || 'DeMo1';
argv.system = argv.system || 'demo';
argv.options = argv.options || undefined;

function RPCShell() {
    this.rpc = api.new_rpc();
    this.client = this.rpc.new_client();
}

function construct_rpc_arguments(str_args) {
    var ret_json;
    try {
        ret_json = JSON.parse(str_args);
    } catch (err) {
        console.error(err);
        return null;
    }
    return ret_json;
}

//Construct a map of different API topics and their functions
RPCShell.prototype.init = function() {
    var self = this;
    this.APIs = {};
    var ignore_keys = [
        'options',
        'common',
        'create_auth_token',
        'create_access_key_auth'
    ];

    return P.fcall(function() {
            var auth_params = {
                email: argv.email,
                password: argv.password,
                system: argv.system
            };
            return self.client.create_auth_token(auth_params);
        })
        .then(function() {
            _.each(_.keys(self.client), function(k) {
                if (_.indexOf(ignore_keys, k) === -1) {
                    self.APIs[k] = _.values(_.omit(_.keys(self.client[k]), 'options'));
                }
            });
        });
};

//List of categories
RPCShell.prototype.list = function() {
    console.log('\nAvailable APIs are:\n', _.keys(this.APIs));
    if (!argv.run) {
        repl_srv.displayPrompt();
    }
};

//List of commands
RPCShell.prototype.list_functions = function() {
    var list_str = '\nAvailable commands are:\n' +
        '    .list - show available API\n' +
        '    .show - show all functions under a specific API\n' +
        '    .call <API> <FUNC> [args] - invokes the RPC call API.FUNC and passes args as arguments\n' +
        '    .params <API> <FUNC> - show all parameters under function of a specific API';
    console.log(list_str);

    list_str = '\nRun shell command using parameter --run (show/list/call/params)\n' +
        '    --api - API to use\n' +
        '    --func - Function to run under the specified API\n' +
        '    --params - Parameters under Function of a specific API ( JSON String example: --params \'{ "key" : "val" }\' )';
    console.log(list_str);
    if (!argv.run) {
        repl_srv.displayPrompt();
    }
};

//Show all functions under a specific API
RPCShell.prototype.show = function(apiname) {
    if (argv.run) {
        apiname = argv.api;
    }

    if (this.APIs[apiname] === undefined) {
        console.log(apiname, 'API does not exist');
        if (argv.run) {
            process.exit(1);
        }
        return;
    }
    console.log('\nAvailable function for', apiname, 'API are:\n', this.APIs[apiname]);
    if (!argv.run) {
        repl_srv.displayPrompt();
    }
};

RPCShell.prototype.call = function(str_args) {
    var args = [];
    var params;
    var self = this;
    if (argv.run) {
        args[0] = argv.api;
        args[1] = argv.func;
        params = argv.params;
    } else {
        args = str_args.split(' ');
        params = _.slice(args, 2).join('');
    }
    params = params || '{}';

    //Verify API name
    if (!args[0]) {
        console.warn('API not supplied');
    } else if (!this.APIs[args[0]]) {
        console.log(args[0], 'API does not exist');
        if (argv.run) {
            process.exit(1);
        }
        return;
    }

    //Verify Function
    if (!args[1]) {
        console.warn('Function name not supplied for', args[0]);
    }
    var func_ind = _.indexOf(this.APIs[args[0]], args[1]);
    if (func_ind === -1) {
        console.log(args[1], 'Function does not exist for', args[0]);
        if (argv.run) {
            process.exit(1);
        }
        return;
    }

    var apiname = args[0];
    var func = this.APIs[args[0]][func_ind];
    var rpc_args = construct_rpc_arguments(params);
    if (rpc_args === null) {
        console.error('Invalid JSON String', params);
        if (argv.run) {
            process.exit(1);
        }
        return;
    }

    console.log('Invoking RPC', apiname + '.' + func + '(' + util.inspect(rpc_args) + ')');
    return P.fcall(function() {
            return self.client[apiname][func](rpc_args, argv.options);
        })
        .catch(function(err) {
            console.warn('Recieved error', err.stack || err);
            if (argv.run) {
                process.exit(1);
            } else {
                repl_srv.displayPrompt();
            }
        })
        .then(function(res) {
            if (argv.json) {
                res = JSON.stringify(res);
            }

            console.log('Got back result:\n', res);

            if (!argv.run) {
                repl_srv.displayPrompt();
            }

        });
};

RPCShell.prototype.params = function(str_args) {
    var args = [];
    var self = this;

    if (argv.run) {
        args[0] = argv.api;
        args[1] = argv.func;
        args[2] = argv.params;
    } else {
        args = str_args.split(' ');
    }

    //Verify API name
    if (!args[0]) {
        console.warn('API not supplied');
    } else if (!this.APIs[args[0]]) {
        console.log(args[0], 'API does not exist');
        if (argv.run) {
            process.exit(1);
        }
        return;
    }

    //Verify Function
    if (!args[1]) {
        console.warn('Function name not supplied for', args[0]);
    }
    var func_ind = _.indexOf(this.APIs[args[0]], args[1]);
    if (func_ind === -1) {
        console.log(args[1], 'Function does not exist for', args[0]);
        if (argv.run) {
            process.exit(1);
        }
        return;
    }

    var apiname = args[0];
    var func = this.APIs[args[0]][func_ind];
    return P.fcall(function() {
            console.log(`Parameters of ${apiname}.${func} are:`, self.rpc.schema[apiname + '_api'].methods[func].params);
            if (!argv.run) {
                repl_srv.displayPrompt();
            }
        })
        .catch(function(err) {
            console.warn('Recieved error', err.stack || err);
            if (argv.run) {
                process.exit(1);
            } else {
                repl_srv.displayPrompt();
            }
        });
};

function main() {
    rpcshell.init().then(function() {
            if (argv.run) {
                // rpcshell.list();
                // rpcshell.list_functions();
                return rpcshell[argv.run]();
            } else {
                // start a Read-Eval-Print-Loop
                repl_srv = repl.start({
                    prompt: 'rpc-shell > ',
                    useGlobal: false,
                    ignoreUndefined: true
                });
                //Bind RPCshell functions to repl
                _.forIn(rpcshell, function(val, key) {
                    if (typeof(val) === 'function') {
                        var action = val.bind(rpcshell);
                        repl_srv.defineCommand(key, {
                            action: action
                        });

                    } else {
                        repl_srv.context[key] = val;
                    }
                });
                rpcshell.list();
                rpcshell.list_functions();
            }
        }, function(err) {
            console.error('init err:' + err);
        })
        .then(() => {
            if (argv.run) {
                process.exit();
            }
        });
}

if (require.main === module) {
    main();
}
