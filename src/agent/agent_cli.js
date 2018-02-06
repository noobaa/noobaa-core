/* Copyright (C) 2016 NooBaa */
'use strict';

require('../util/panic');

const _ = require('lodash');
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const repl = require('repl');
const uuid = require('uuid/v4');
const argv = require('minimist')(process.argv);
const S3Auth = require('aws-sdk/lib/signers/s3');
const child_process = require('child_process');

const P = require('../util/promise');
const api = require('../api');
const dbg = require('../util/debug_module')(__filename);
const Agent = require('./agent');
const fs_utils = require('../util/fs_utils');
const os_utils = require('../util/os_utils');
const Semaphore = require('../util/semaphore');
const json_utils = require('../util/json_utils');
const promise_utils = require('../util/promise_utils');

module.exports = AgentCLI;

const CREATE_TOKEN_RESPONSE_TIMEOUT = 30 * 1000; // 30s timeout for master to respond to HB
const CREATE_TOKEN_RETRY_INTERVAL = 10 * 1000;
const DETECT_NEW_DRIVES_INTERVAL = 60 * 1000;

const S3_AGENT_NAME_PREFIX = 's3-agent-';

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
    this.params.hostname = this.params.test_hostname || os.hostname();
    const agent_conf_name = this.params.test_hostname ? 'agent_conf_' + this.params.test_hostname + '.json' : 'agent_conf.json';
    this.agent_conf = new json_utils.JsonFileWrapper(agent_conf_name);
}

AgentCLI.prototype.monitor_stats = function() {
    promise_utils.pwhile(() => true, () => {
        const cpu_usage = process.cpuUsage(this.cpu_usage); //usage since init
        const mem_usage = process.memoryUsage();
        dbg.log0(`agent_stats_titles - process: cpu_usage_user, cpu_usage_sys, mem_usage_rss`);
        dbg.log0(`agent_stats_values - process: ${cpu_usage.user}, ${cpu_usage.system}, ${mem_usage.rss}`);
        for (const agent of Object.keys(this.agents)) {
            const agent_stats = this.agents[agent].sample_stats();
            if (agent_stats) {
                const agent_stats_keys = Object.keys(agent_stats);
                dbg.log0(`agent_stats_titles - ${agent}: ` + agent_stats_keys.join(', '));
                dbg.log0(`agent_stats_values - ${agent}: ` + agent_stats_keys.map(key => agent_stats[key]).join(', '));
            }
        }
        return P.delay(60000);
    });
};

/**
 *
 * INIT
 *
 *
 *
 */
AgentCLI.prototype.init = function() {
    var self = this;

    if (self.params.access_key) {
        self.params.access_key = self.params.access_key.toString();
    }
    if (self.params.secret_key) {
        self.params.secret_key = self.params.secret_key.toString();
    }

    self.cpu_usage = process.cpuUsage();

    self.monitor_stats();


    return self.agent_conf.read()
        .then(function(agent_conf) {
            dbg.log0('using agent_conf.json', util.inspect(agent_conf));
            _.defaults(self.params, agent_conf);
        })
        .then(null, function(err) {
            dbg.log0('cannot find configuration file. Using defaults.', err);
        })
        .then(function() {
            _.defaults(self.params, {
                root_path: './noobaa_storage/',
                access_key: '123',
                secret_key: 'abc',
                system: 'demo',
                bucket: 'first.bucket'
            });
            if (self.params.address) {
                self.client.options.address = self.params.address;
            }

            if (!self.params.host_id) {
                self.params.host_id = uuid();
                return self.agent_conf.update({
                    host_id: self.params.host_id
                });
            }
        })
        .then(() => os_utils.get_disk_mount_points())
        .then(mount_points => self.update_ignored_drives(mount_points))
        .tap(mount_points => self.rename_agent_storage(mount_points))
        .then(function(mount_points) {
            if (self.params.test_hostname) {
                self.params.root_path = './noobaa_storage_' + self.params.test_hostname;
                mount_points[0].mount = self.params.root_path;
            } else {
                self.params.root_path = mount_points[0].mount;
            }

            dbg.log0('root path:', self.params.root_path);
            self.params.all_storage_paths = mount_points;

            if (self.params.cleanup) {
                return P.all(_.map(self.params.all_storage_paths, storage_path_info => {
                    var storage_path = storage_path_info.mount;
                    var path_modification = storage_path.replace('/noobaa_storage/', '')
                        .replace('/', '')
                        .replace('.', '');
                    return fs_utils.folder_delete(path_modification);
                }));
            } else if (self.params.duplicate || self.params.notfound) {
                let reason = self.params.duplicate ? 'duplicate' : 'notfound';
                let target_noobaa_storage = reason + '_noobaa_storage_' + Date.now();
                dbg.log0(`got ${reason} flag - renaming noobaa_storage to ${target_noobaa_storage}`);
                return P.all(_.map(self.params.all_storage_paths, storage_path_info => {
                        // move noobaa_storage in all drives to an alternate location
                        let storage_path = storage_path_info.mount;
                        let target_path = storage_path.replace('noobaa_storage', target_noobaa_storage);
                        dbg.log0('moving', storage_path, 'to', target_path);
                        return fs.renameAsync(storage_path, target_path);
                    }))
                    // remove host_id from agent_conf
                    .then(() => self.agent_conf.update({
                        host_id: undefined
                    }))
                    .then(() => {
                        dbg.log0('exit agent_cli. will restart with new noobaa_storage');
                        process.exit(0);
                    })
                    .catch(err => {
                        dbg.error('got error while handling duplication!!', err);
                        process.exit(1);
                    });
            } else {
                return self.load()
                    .then(function() {
                        dbg.log0('COMPLETED: load');
                    });
            }
        })
        .then(function() {
            return self.detect_new_drives();
        }, function(err) {
            dbg.error('ERROR: load', self.params, err.stack);
            throw new Error(err);
        });
};

AgentCLI.prototype.init.helper = function() {
    dbg.log0("Init client");
};


AgentCLI.prototype.detect_new_drives = function() {
    var self = this;
    const retry = () => {
        setTimeout(() => self.detect_new_drives(), DETECT_NEW_DRIVES_INTERVAL);
    };

    return os_utils.get_disk_mount_points()
        .then(added_mount_points => {
            let added_paths = _.differenceWith(added_mount_points, self.params.all_storage_paths,
                (a, b) => String(a.drive_id) === String(b.drive_id));
            if (_.isEmpty(added_paths)) return P.resolve();
            added_paths = _.filter(added_paths, added_path => !_.includes(self.params.ignore_drives || [], added_path.drive_id));
            if (_.isEmpty(added_paths)) return P.resolve();
            dbg.log0('identified new drives:', added_paths);
            return self.load(added_paths)
                .then(function() {
                    dbg.log0('Drives added:', added_paths);
                    self.params.all_storage_paths = _.concat(self.params.all_storage_paths, added_paths);
                });
        })
        .finally(() => retry());
};

AgentCLI.prototype.rename_agent_storage = function(mount_points) {
    if (os.type() === 'Darwin') return; // skip rename in mac os
    dbg.log0(`looking for agent_storage folder and renaming to noobaa_storage`);
    return P.map(mount_points, mount_point => {
        let old_path = mount_point.mount.replace('noobaa_storage', 'agent_storage');
        // for root mount or c:\ the old agent_storage location was under installation dir
        // fix for windows or linux
        if (old_path === '/agent_storage/') {
            old_path = './agent_storage/';
        } else if (old_path.toLowerCase() === 'c:\\agent_storage\\') {
            old_path = '.\\agent_storage\\';
        }
        return fs_utils.file_must_exist(old_path)
            .then(() => fs_utils.file_must_not_exist(mount_point.mount))
            .then(() => {
                    dbg.log0(`renaming ${old_path} to ${mount_point.mount}`);
                    return fs.renameAsync(old_path, mount_point.mount)
                        .catch(err => {
                            dbg.error(`failed renaming ${old_path} to ${mount_points.mount}. got error:`, err);
                            throw err;
                        });
                },
                err => dbg.log0(`skipping rename for mount ${mount_point.mount}`, err.message));
    });
};

AgentCLI.prototype.update_ignored_drives = function(mount_points) {
    if (os.type() === 'Darwin') return mount_points; // skip rename in mac os
    this.params.ignore_drives = this.params.ignore_drives || [];
    return P.map(mount_points, mount_point => {
        if (mount_point.temporary_drive) {
            if (!_.find(this.params.ignore_drives, drive => drive === mount_point.drive_id)) {
                dbg.log0(`found new drive to ignore ${mount_point.drive_id}`);
                this.params.ignore_drives.push(mount_point.drive_id);
                this.agent_conf.update({ ignore_drives: this.params.ignore_drives });
            }
        }
    }).then(() => _.filter(mount_points, mount_point => !this.params.ignore_drives.includes(mount_point.drive_id)));
};

/**
 *
 * LOAD
 *
 * create account, system, tier, bucket.
 *
 */
AgentCLI.prototype.load = function(added_storage_paths) {
    var self = this;
    let paths_to_work_on = added_storage_paths || self.params.all_storage_paths;

    let internal_agent_prefix = 'noobaa-internal-agent-';

    // TODO: This has to work on partitial relevant paths only
    // handle regular agents
    dbg.log0('Loading agents', paths_to_work_on);
    return P.all(_.map(paths_to_work_on, function(storage_path_info) {
            var storage_path = storage_path_info.mount;
            dbg.log0('root_path', storage_path);

            return P.resolve()
                .then(() => fs_utils.create_path(storage_path, fs_utils.PRIVATE_DIR_PERMISSIONS))
                .then(() => P.resolve(self.hide_storage_folder(storage_path))
                    .catch(err => {
                        dbg.error('Windows - failed to hide', err.stack || err);
                        // TODO really continue on error?
                    }))
                .then(() => fs.readdirAsync(storage_path))
                .then(nodes_names => {
                    // filter out cloud and mongo agents:
                    let regular_node_names = _.reject(nodes_names,
                        name => name.startsWith(internal_agent_prefix));

                    dbg.log0('nodes_names:', regular_node_names);
                    return P.map(regular_node_names, node_name => {
                        dbg.log0('node_name', node_name, 'storage_path', storage_path);
                        var node_path = path.join(storage_path, node_name);
                        return self.start(node_name, node_path);
                    });
                });
        }))
        .then(storage_path_nodes => {
            // no need to load s3 when adding new drives
            if (added_storage_paths) return storage_path_nodes;
            // if no s3 agent exist for root storage path, run one
            let s3_started = _.find(_.flatten(storage_path_nodes), name => this._is_s3_agent(name));
            if (!s3_started) {
                const root_storage_path = self.params.all_storage_paths.find(storage_path => storage_path.mount === '/noobaa_storage') ||
                    self.params.all_storage_paths[0];
                // create path for s3 agent. it will be used if agent_conf contains s3 role
                dbg.log0(`creating s3 storage_path in ${root_storage_path}`);
                return self.create_node_helper(root_storage_path, {
                        is_s3_agent: true
                    })
                    // return storage nodes that will be created according to scale
                    .then(() => storage_path_nodes);
            }
            dbg.log0(`found started s3 node ${s3_started}. skipping creation`);
            // remover s3 node name from storage_path_nodes[0] so scale will be calculated according to storage nodes only.
            storage_path_nodes[0] = _.reject(storage_path_nodes[0], name => this._is_s3_agent(name));
            return storage_path_nodes;
        })
        .then(storage_path_nodes => {
            var nodes_scale = 0;
            var number_of_new_paths = 0;
            var existing_nodes_count = 0;
            _.each(storage_path_nodes, function(nodes) {
                // assumes same amount of nodes per each HD. we will take the last one.
                if (nodes.length) {
                    existing_nodes_count = nodes.length;
                } else {
                    number_of_new_paths += 1;
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
                paths_to_work_on.length > number_of_new_paths) {
                dbg.log0('Introducing new HD, while other exist. Adding only one node for these new drives');
                nodes_to_add = 0; //special case, the create_some will add only to new HD
            } else {
                nodes_to_add = Math.max(nodes_scale, 1) - existing_nodes_count;
            }
            if (nodes_to_add < 0) {
                dbg.warn('NODES SCALE DOWN IS NOT YET SUPPORTED ...');
            } else {
                return self.create_some(nodes_to_add, paths_to_work_on);
            }
        })
        .catch(err => {
            dbg.log0('load failed ' + err.stack);
            throw err;
        });
};

AgentCLI.prototype.hide_storage_folder = function(current_storage_path) {
    var self = this;
    dbg.log0('os:', os.type());
    if (os.type().indexOf('Windows') >= 0) {
        var current_path = current_storage_path;
        current_path = current_path.substring(0, current_path.length - 1);
        current_path = current_path.replace('./', '');

        //hiding storage folder
        return child_process.execAsync('attrib +H ' + current_path)
            .then(() => P.join(
                os_utils.is_folder_permissions_set(current_path),
                fs.readdirAsync(current_path)
            ))
            .spread(function(permissions_set, noobaa_storage_initialization) {
                if (!permissions_set) {
                    if (_.isEmpty(noobaa_storage_initialization)) {
                        dbg.log0('First time icacls configuration');
                        //Setting system full permissions and remove builtin users permissions.
                        //TODO: remove other users
                        child_process.execAsync(
                                'icacls ' + current_path +
                                ' /grant:r administrators:(oi)(ci)F' +
                                ' /grant:r system:F' +
                                ' /remove:g BUILTIN\\Users' +
                                ' /inheritance:r')
                            .then(() => {
                                dbg.log0('Icacls configuration success');
                            })
                            .catch(function(err) {
                                dbg.error('Icacls configuration failed with:', err);
                            });
                    } else {
                        dbg.log0('Icacls configurations were touched');
                        self.permission_tempering = Date.now();
                    }
                }
            });
    }
};

AgentCLI.prototype.load.helper = function() {
    dbg.log0("create token, start nodes ");
};

AgentCLI.prototype.create_node_helper = function(current_node_path_info, options) {
    var self = this;

    let { is_s3_agent } = (options || {});

    return P.fcall(function() {
        dbg.log0('create_node_helper called with self.params', self.params);
        var current_node_path = current_node_path_info.mount;
        const name_prefix = is_s3_agent ? S3_AGENT_NAME_PREFIX : '';
        var node_name = name_prefix + self.params.hostname;
        const noobaa_storage_dir_name = self.params.test_hostname ? 'noobaa_storage_' + self.params.test_hostname : 'noobaa_storage';
        var path_modification = current_node_path.replace('/' + noobaa_storage_dir_name + '/', '').replace(/\//g, '')
            .replace('.', '');
        //windows
        path_modification = path_modification.replace('\\' + noobaa_storage_dir_name + '\\', '');
        dbg.log0('create_node_helper with path_modification', path_modification, 'node:',
            node_name, 'current_node_path', current_node_path, 'exists');
        if (os.type().indexOf('Windows') >= 0) {
            node_name = node_name + '-' + current_node_path_info.drive_id.replace(':', '');
        } else if (!_.isEmpty(path_modification)) {
            node_name = node_name + '-' + path_modification.replace('/', '');
        }
        node_name += '-' + self.params.host_id.split('-')[0];

        var node_path = path.join(current_node_path, node_name);
        var token_path = path.join(node_path, 'token');
        dbg.log0('create new node for node name', node_name, ' path:', node_path, ' token path:', token_path);

        return fs_utils.file_must_not_exist(token_path)
            .then(function() {
                if (self.params.create_node_token) return;
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
                    return self.create_auth_token(auth_params);
                }
            })
            .then(function(res) {
                if (res) {
                    dbg.log0('result create:', res, 'node path:', node_path);
                    self.params.create_node_token = res.token;
                    // replace access_key\secret_key with create_node_token in agnet_conf
                    return self.agent_conf.update({
                        access_key: undefined,
                        secret_key: undefined,
                        create_node_token: self.params.create_node_token
                    });
                } else {
                    dbg.log0('has token', self.params.create_node_token);
                }
            })
            .then(() => fs_utils.create_path(node_path, fs_utils.PRIVATE_DIR_PERMISSIONS))
            .then(function() {
                dbg.log0('writing token', token_path);
                return fs_utils.replace_file(token_path, self.params.create_node_token);
            })
            .then(function() {
                dbg.log0('about to start node', node_path, 'with node name:', node_name);
                return self.start(node_name, node_path);
            })
            .then(function(res) {
                dbg.log0('created', node_name);
                return res;
            })
            .then(null, function(err) {
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
AgentCLI.prototype.create = function(number_of_nodes, paths_to_work_on) {
    var self = this;
    let storage_paths_to_add = paths_to_work_on || self.params.all_storage_paths;
    //create root path last. First, create all other.
    // for internal_agents only use root path
    return P.all(_.map(_.drop(storage_paths_to_add, 1), function(current_storage_path) {
            return fs.readdirAsync(current_storage_path.mount)
                .then(function(files) {
                    if (files.length > 0 && number_of_nodes === 0) {
                        //if new HD introduced,  skip existing HD.
                    } else {
                        return self.create_node_helper(current_storage_path);
                    }
                });
        }))
        .then(function() {
            //create root folder
            if (storage_paths_to_add.length > 1) {
                return fs.readdirAsync(storage_paths_to_add[0].mount)
                    .then(function(files) {
                        if (files.length > 0 && number_of_nodes === 0) {
                            //if new HD introduced,  skip existing HD.
                        } else {
                            return self.create_node_helper(storage_paths_to_add[0]);
                        }
                    });
            } else if (number_of_nodes === 0) {
                return undefined;
            } else {
                return self.create_node_helper(storage_paths_to_add[0]);
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
AgentCLI.prototype.create_some = function(n, paths_to_work_on) {
    var self = this;
    //special case, new HD introduction to the system. adding only these new HD nodes
    if (n === 0) {
        return self.create(0, paths_to_work_on);
    } else {
        var sem = new Semaphore(5);
        return P.all(_.times(n, function() {
            return sem.surround(function() {
                return self.create(n, paths_to_work_on);
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
    dbg.log0('agent started ', node_path, node_name);

    var agent = self.agents[node_name];
    if (!agent) {
        // token wrapper is used by agent to read\write token
        let token_path = path.join(node_path, 'token');
        let token_wrapper = {
            read: () => fs.readFileAsync(token_path),
            write: token => fs_utils.replace_file(token_path, token),
        };
        let create_node_token_wrapper = {
            read: () => this.agent_conf.read()
                .then(agent_conf => agent_conf.create_node_token),
            write: new_token => this.agent_conf.update({
                create_node_token: new_token
            })
        };

        agent = new Agent({
            address: self.params.address,
            servers: self.params.servers,
            node_name: node_name,
            test_hostname: self.params.test_hostname,
            host_id: self.params.host_id,
            storage_path: node_path,
            permission_tempering: self.permission_tempering,
            storage_limit: self.params.storage_limit,
            is_demo_agent: self.params.demo,
            agent_conf: self.agent_conf,
            token_wrapper: token_wrapper,
            create_node_token_wrapper: create_node_token_wrapper,
            s3_agent: this._is_s3_agent(node_name)
        });
        self.agents[node_name] = agent;

        dbg.log0('agent inited', node_name, self.params.address, self.params.port, self.params.secure_port, node_path);
    }

    return P.fcall(function() {
        return promise_utils.retry(100, 1000, agent.start.bind(agent));
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
        i += 1;
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

AgentCLI.prototype.create_auth_token = function(auth_params) {
    return P.resolve()
        .then(() => this.client.create_access_key_auth(auth_params))
        .timeout(CREATE_TOKEN_RESPONSE_TIMEOUT)
        .catch(err => {
            dbg.error('create_auth_token failed', err);
            return P.delay(CREATE_TOKEN_RETRY_INTERVAL)
                .then(() => this.create_auth_token(auth_params));

        });
};

function populate_general_help(general) {
    general.push('show("<function>"") to show help on a specific API');
}


AgentCLI.prototype._is_s3_agent = function(node_name) {
    return node_name.startsWith(S3_AGENT_NAME_PREFIX);
};

AgentCLI.prototype._is_s3_enabled = function(node_name) {
    return (this.params.roles && this.params.roles.indexOf('S3') >= 0);
};

AgentCLI.prototype.repl = function() {
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
    _.forIn(this, (val, key) => {
        if (typeof(val) === 'function') {
            repl_srv.context[key] = val.bind(this);
            help.functions.push(key);
        } else {
            repl_srv.context[key] = val;
            help.variables.push(key);
        }
    });
    populate_general_help(help.general);
    repl_srv.context.help = help;
    repl_srv.context.dbg = dbg;
};

AgentCLI.main = main;

function main() {
    if (argv.node_name) {
        dbg.set_process_name('Internal-Agent-' + argv.node_name);
    } else {
        dbg.set_process_name('Agent');
    }

    if (argv.scale) {
        return P.map(_.range(0, argv.scale), i => {
            let params = _.clone(argv);
            params.test_hostname = `${os.hostname()}-${i}`;
            let test_agent_cli = new AgentCLI(params);
            return test_agent_cli.init();
        });
    } else {
        var cli = new AgentCLI(argv);
        return cli.init()
            .then(() => argv.repl && cli.repl());
    }
}

if (require.main === module) {
    main();
}
