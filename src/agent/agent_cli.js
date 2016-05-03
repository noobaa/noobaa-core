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
var S3Auth = require('aws-sdk/lib/signers/s3');
var uuid = require('node-uuid');
var os = require('os');
var os_util = require('../util/os_util');

module.exports = AgentCLI;

setInterval(function() {
    dbg.log0('memory usage', process.memoryUsage());
}, 30000);

if (argv.cloud_pool_name) {
    dbg.set_process_name(argv.cloud_pool_name + '-Agent');
} else {
    dbg.set_process_name('Agent');
}

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
    var rpc = api.new_rpc();
    this.client = rpc.new_client();
    this.s3 = new S3Auth();
    this.agents = {};
}

function deleteFolderRecursive(path) {
    if (fs.existsSync(path)) {
        fs.readdirSync(path).forEach(function(file, index) {
            var curPath = path + "/" + file;
            dbg.log0('deleting0', curPath);

            if (fs.lstatSync(curPath).isDirectory()) { // recurse
                deleteFolderRecursive(curPath);
            } else { // delete file
                dbg.log0('deleting', curPath);
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(path);
    }
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


    if (self.params.cloud_endpoint) {
        // if we got endpoint then verify all params exist and set cloud_info object.

        let verify_param = function(param) {
            if (_.isUndefined(self.params[param])) {
                dbg.error('cloud agent init: missing ' + param + '. cloud_endpoint=', self.params.cloud_endpoint);
                return false;
            }
            return true;
        };

        if (!(
                verify_param('cloud_bucket') &&
                verify_param('cloud_access_key') &&
                verify_param('cloud_secret_key') &&
                verify_param('cloud_pool_name'))) {
            process.exit(1);
        }

        self.cloud_info = {
            endpoint: self.params.cloud_endpoint,
            target_bucket: self.params.cloud_bucket,
            access_keys: {
                access_key: self.params.cloud_access_key,
                secret_key: self.params.cloud_secret_key
            },
            cloud_pool_name: self.params.cloud_pool_name
        };

    }

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
                bucket: 'files'
            });
            if (self.params.address) {
                self.client.options.address = self.params.address;
            }
            return os_util.read_drives();
        })
        .then(function(drives) {
            dbg.log0('drives:', drives, ' current location ', process.cwd());
            var hds = _.filter(drives, function(hd_info) {
                if ((hd_info.drive_id.indexOf('by-uuid') < 0 &&
                        hd_info.mount.indexOf('/etc/hosts') < 0 &&
                        (hd_info.drive_id.indexOf('/dev/') >= 0 || hd_info.mount === '/') &&
                        hd_info.mount.indexOf('/boot') < 0 &&
                        hd_info.mount.indexOf('/Volumes/') < 0) ||
                    (hd_info.drive_id.length === 2 &&
                        hd_info.drive_id.indexOf(':') === 1)) {
                    dbg.log0('Found relevant volume', hd_info.drive_id);
                    return true;
                }
            });
            var server_uuid = os.hostname() + '-' + uuid();
            console.log('Server:' + server_uuid + ' with HD:' + JSON.stringify(hds));

            var mount_points = [];

            if (os.type() === 'Windows_NT') {
                _.each(hds, function(hd_info) {
                    if (process.cwd().toLowerCase().indexOf(hd_info.drive_id.toLowerCase()) === 0) {
                        hd_info.mount = './agent_storage/';
                        mount_points.push(hd_info);
                    } else {
                        hd_info.mount = hd_info.mount + '\\agent_storage\\';
                        mount_points.push(hd_info);
                    }
                });
            } else {
                _.each(hds, function(hd_info) {
                    if (hd_info.mount === "/") {
                        hd_info.mount = './agent_storage/';
                        mount_points.push(hd_info);
                    } else {
                        hd_info.mount = '/' + hd_info.mount + '/agent_storage/';
                        mount_points.push(hd_info);
                    }
                });
            }

            dbg.log0('mount_points:', mount_points);
            self.params.root_path = mount_points[0].mount;

            dbg.log0('root path:', self.params.root_path);
            self.params.all_storage_paths = mount_points;

            if (self.params.cleanup) {
                return P.all(_.map(self.params.all_storage_paths, function(storage_path_info) {
                    var storage_path = storage_path_info.mount;
                    var path_modification = storage_path.replace('/agent_storage/', '').replace('/', '').replace('.', '');
                    deleteFolderRecursive(path_modification);
                }));
            } else {
                return self.load()
                    .then(function() {
                        dbg.log0('COMPLETED: load');
                    });
            }
        }).then(null, function(err) {
            dbg.error('ERROR: load', self.params, err.stack);
            throw new Error(err);
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

    let cloud_agent_prefix = 'noobaa-cloud-agent-';
    // if this is a cloud agent, check if its path exists already, and start the agent
    if (self.cloud_info) {
        dbg.log0('loading agent with cloud_info: ', self.cloud_info);
        let storage_path = self.params.all_storage_paths[0].mount;
        let node_name = cloud_agent_prefix + os.hostname() + '-' + self.cloud_info.cloud_pool_name;
        return P.nfcall(mkdirp, storage_path)
            .then(() => P.nfcall(fs.readdir, storage_path))
            .then(nodes_names => {
                if (nodes_names.indexOf(node_name) >= 0) {
                    // cloud node already exist. start it
                    let node_path = path.join(storage_path, node_name);
                    dbg.log0('loading existing cloud agent. node_path=', node_path);
                    return self.start(node_name, node_path);
                } else {
                    dbg.log0('starting new cloud agent. node_name = ', node_name);
                    return self.create_node_helper(self.params.all_storage_paths[0], node_name);
                }
            });
    }

    // handle regular agents
    dbg.log0('Loading agents', self.params.all_storage_paths);
    return P.all(_.map(self.params.all_storage_paths, function(storage_path_info) {
            var storage_path = storage_path_info.mount;

            return P.fcall(function() {
                    return P.nfcall(mkdirp, storage_path);
                })
                .then(function() {
                    return self.hide_storage_folder(storage_path);
                })
                .then(null, function(err) {
                    dbg.error('Windows - failed to hide', err.stack || err);
                    // TODO really continue on error?
                })
                .then(function() {
                    dbg.log0('root_path', storage_path);
                    return P.nfcall(fs.readdir, storage_path);
                })
                .then(function(nodes_names) {
                    // filter out cloud agents:
                    let regular_node_names = _.reject(nodes_names, name => name.startsWith(cloud_agent_prefix));

                    dbg.log0('nodes_names:', regular_node_names);
                    return P.all(_.map(regular_node_names, function(node_name) {
                        dbg.log0('node_name', node_name, 'storage_path', storage_path);
                        var node_path = path.join(storage_path, node_name);
                        return self.start(node_name, node_path);
                    }));
                });
        }))
        .then(function(storage_path_nodes) {
            var nodes_scale = parseInt(self.params.scale, 10) || 0;
            var number_of_new_paths = 0;
            var existing_nodes_count = 0;
            _.each(storage_path_nodes, function(nodes) {
                //assumes same amount of nodes per each HD. we will take the last one.
                if (!nodes.length) {
                    number_of_new_paths += 1;
                } else {
                    existing_nodes_count = nodes.length;
                }
            });
            // we create a new node for every new drive (detects as a storage path without nodes)
            // but here we also consider the development mode of --scale
            // which asks to create at least that number of total nodes.
            // Please note that the sacle is per storage path. if the scale is 2 and there are two HD
            // we will have 4 nodes. In addition, we will always scale to at least 1 node
            var nodes_to_add = 0;
            dbg.log0('AGENTS SCALE TO', nodes_scale);
            dbg.log0('AGENTS EXISTING', existing_nodes_count);
            dbg.log0('AGENTS NEW PATHS', number_of_new_paths);
            if (number_of_new_paths > 0 &&
                self.params.all_storage_paths.length > number_of_new_paths) {
                dbg.log0('Introducing new HD, while other exist. Adding only one node for these new drives');
                nodes_to_add = 0; //special case, the create_some will add only to new HD
            } else {
                nodes_to_add = Math.max(nodes_scale, 1) - existing_nodes_count;
            }
            if (nodes_to_add < 0) {
                dbg.warn('NODES SCALE DOWN IS NOT YET SUPPORTED ...');
            } else {
                return self.create_some(nodes_to_add);
            }
        })
        .then(null, function(err) {
            dbg.log0('load failed ' + err.stack);
            throw err;
        });


};

AgentCLI.prototype.hide_storage_folder = function(current_storage_path) {
    dbg.log0('os:', os.type());
    if (os.type().indexOf('Windows') >= 0) {
        var current_path = current_storage_path;
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

AgentCLI.prototype.create_node_helper = function(current_node_path_info, cloud_node_name) {
    var self = this;

    return P.fcall(function() {
        var current_node_path = current_node_path_info.mount;
        var node_name = cloud_node_name || os.hostname() + '-' + uuid();
        var path_modification = current_node_path.replace('/agent_storage/', '').replace('/', '').replace('.', '');
        //windows
        path_modification = path_modification.replace('\\agent_storage\\', '');


        var node_path = path.join(current_node_path, node_name);
        var token_path = path.join(node_path, 'token');
        dbg.log0('create_node_helper with path_modification', path_modification, 'node:', node_path, 'current_node_path', current_node_path, 'exists');

        if (os.type().indexOf('Windows') >= 0) {
            node_name = node_name + '-' + current_node_path_info.drive_id.replace(':', '');
        } else {
            if (!_.isEmpty(path_modification)) {
                node_name = node_name + '-' + path_modification.replace('/', '');
            }
        }
        dbg.log0('create new node for node name', node_name, ' path:', node_path, ' token path:', token_path);


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
                        signature: signature,
                    };
                    dbg.log0('create_access_key_auth', auth_params);
                    return self.client.create_access_key_auth(auth_params);
                }
            })
            .then(function(res) {
                if (res) {
                    dbg.log0('result create:', res, 'node path:', node_path);
                    self.create_node_token = res.token;
                } else {
                    dbg.log0('has token', self.create_node_token);
                }
                return P.nfcall(mkdirp, node_path);
            }).then(function() {
                dbg.log0('writing token', token_path);
                return P.nfcall(fs.writeFile, token_path, self.create_node_token);
            })
            .then(function() {
                if (_.isUndefined(self.params.internal_agent)) {
                    // remove access_key and secret_key from agent_conf after a token was acquired
                    return P.nfcall(fs.readFile, 'agent_conf.json')
                        .then(function(data) {
                            let agent_conf = JSON.parse(data);
                            delete agent_conf.access_key;
                            delete agent_conf.secret_key;
                            var write_data = JSON.stringify(agent_conf);
                            return P.nfcall(fs.writeFile, 'agent_conf.json', write_data);
                        })
                        .catch(function(err) {
                            if (err.code === 'ENOENT') {
                                console.warn('No agent_conf.json file exists');
                                return;
                            }
                            throw new Error(err);
                        });

                }
            })
            .then(function() {
                dbg.log0('about to start node', node_path, 'with node name:', node_name);
                return self.start(node_name, node_path);
            }).then(function(res) {
                dbg.log0('created', node_name);
                return res;
            }).then(null, function(err) {
                dbg.log0('create failed', node_name, err, err.stack);
                throw err;
            });
    });
};
/**
 *
 * CREATE
 *
 * create new node agent
 *
 */
AgentCLI.prototype.create = function(number_of_nodes) {
    var self = this;
    //create root path last. First, create all other
    return P.all(_.map(_.drop(self.params.all_storage_paths, 1), function(current_storage_path) {
            return fs_utils.list_directory(current_storage_path.mount)
                .then(function(files) {
                    if (files.length > 0 && number_of_nodes === 0) {
                        //if new HD introduced,  skip existing HD.
                        return;
                    } else {
                        return self.create_node_helper(current_storage_path);
                    }
                });
        }))
        .then(function() {
            //create root folder
            if (self.params.all_storage_paths.length > 1) {
                return fs_utils.list_directory(self.params.all_storage_paths[0].mount)
                    .then(function(files) {
                        if (files.length > 0 && number_of_nodes === 0) {
                            //if new HD introduced,  skip existing HD.
                            return;
                        } else {
                            return self.create_node_helper(self.params.all_storage_paths[0]);
                        }
                    });
            } else {
                if (number_of_nodes === 0) {
                    return;
                } else {
                    return self.create_node_helper(self.params.all_storage_paths[0]);
                }
            }
        })
        .then(null, function(err) {
            dbg.error('error while creating node:', err, err.stack);
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
    //special case, new HD introduction to the system. adding only these new HD nodes
    if (n === 0) {
        return self.create(0);
    } else {
        var sem = new Semaphore(5);
        return P.all(_.times(n, function() {
            return sem.surround(function() {
                return self.create(n);
            });
        }));
    }
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
AgentCLI.prototype.start = function(node_name, node_path) {
    var self = this;
    dbg.log0('agent started ', node_path, node_name, self.cloud_info ? 'cloud_info: ' + self.cloud_info : '');

    var agent = self.agents[node_name];
    if (!agent) {

        agent = self.agents[node_name] = new Agent({
            address: self.params.address,
            node_name: node_name,
            storage_path: node_path,
            cloud_info: self.cloud_info
        });

        dbg.log0('agent inited', node_name, self.params.addres, self.params.port, self.params.secure_port, node_path);
    }

    return P.fcall(function() {
        return promise_utils.retry(100, 1000, 1000, agent.start.bind(agent));
    }).then(function(res) {
        dbg.log0('agent started', node_name, 'res', res);
        return node_name;
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
            'node', node_name, 'address', agent.rpc_address);
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

AgentCLI.main = main;

function main() {
    var cli = new AgentCLI(argv);
    cli.init().done(function() {
        if (!argv.repl) return;
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