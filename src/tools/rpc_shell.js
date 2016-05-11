'use strict';

var dotenv = require('dotenv');
dotenv.load();

var _ = require('lodash');
var repl = require('repl');
var util = require('util');
var api = require('../api');
var P = require('../util/promise');
var argv = require('minimist')(process.argv);

var repl_srv;

argv.email = argv.email || 'demo@noobaa.com';
argv.password = argv.password || 'DeMo';
argv.system = argv.system || 'demo';

function RPCShell() {
    this.rpc = api.new_rpc();
    this.client = this.rpc.new_client();
}

function construct_rpc_arguments(str_args) {
    var ret_json = {};
    var words;
    var i;
    //parse each argument on =
    //left of it is the key name, right is the values.
    //if right contains {}, its a complex value, call construct again on it
    if (str_args.length === 1 &&
        str_args[0].indexOf('=') !== -1) {
        _.each(str_args, function(a) {
            i = a.indexOf('=');
            words = [a.slice(0, i), a.slice(i + 1)];
            if (words[1][0] !== '{') {
                ret_json[words[0]] = words[1];
            } else {
                ret_json[words[0]] = construct_rpc_arguments([words[1].substring(1, words[1].length - 1)]);
            }
        });
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
    repl_srv.displayPrompt();
};

//List of commands
RPCShell.prototype.list_functions = function() {
    var list_str = '\nAvailable commands are:\n' +
        '    .list - show available API\n' +
        '    .show - show all functions under a specific API\n' +
        '    .call <API> <FUNC> [args] - invokes the RPC call API.FUNC and passes args as arguments';
    console.log(list_str);
    repl_srv.displayPrompt();
};

//Show all functions under a specific API
RPCShell.prototype.show = function(apiname) {
    if (this.APIs[apiname] === undefined) {
        console.log(apiname, 'API does not exist');
        return;
    }
    console.log('\nAvailable function for', apiname, 'API are:\n', this.APIs[apiname]);
    repl_srv.displayPrompt();
};

RPCShell.prototype.call = function(str_args) {
    var args = str_args.split(' ');
    var self = this;

    //Verify API name
    if (!args[0]) {
        console.warn('API not supplied');
    } else if (!this.APIs[args[0]]) {
        console.log(args[0], 'API does not exist');
        return;
    }

    //Verify Function
    if (!args[1]) {
        console.warn('Function name not supplied for', args[0]);
    }
    var func_ind = _.indexOf(this.APIs[args[0]], args[1]);
    if (func_ind === -1) {
        console.log(args[1], 'Function does not exist for', args[0]);
        return;
    }

    var apiname = args[0];
    var func = this.APIs[args[0]][func_ind];
    var rpc_args = construct_rpc_arguments(_.slice(args, 2));

    console.log('Invoking RPC', apiname + '.' + func + '(' + util.inspect(rpc_args) + ')');
    return P.fcall(function() {
            return self.client[apiname][func](rpc_args);
        })
        .fail(function(error) {
            if (error.rpc_code === 'BAD_REQUEST') {
                console.warn('Bad request');
            } else {
                console.warn('Recieved error', error, error.stack);
            }
            repl_srv.displayPrompt();
            return;
        })
        .then(function(res) {
            console.log('Got back result:\n', res);
            repl_srv.displayPrompt();
        });
};

function main() {
    var rpcshell = new RPCShell();
    rpcshell.init().done(function() {
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
    }, function(err) {
        console.error('init err:' + err);
    });
}

if (require.main === module) {
    main();
}
