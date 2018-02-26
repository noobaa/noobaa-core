/* Copyright (C) 2016 NooBaa */
/* eslint max-lines: ['error', 2500] */
'use strict';

const DEV_MODE = (process.env.DEV_MODE === 'true');

const _ = require('lodash');
const fs = require('fs');
const moment = require('moment');
const url = require('url');
const net = require('net');
const request = require('request');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const pkg = require('../../../package.json');
const diag = require('../utils/server_diagnostics');
const cutil = require('../utils/clustering_utils');
const config = require('../../../config.js');
const dotenv = require('../../util/dotenv');
const MDStore = require('../object_services/md_store').MDStore;
const fs_utils = require('../../util/fs_utils');
const os_utils = require('../../util/os_utils');
const MongoCtrl = require('../utils/mongo_ctrl');
const server_rpc = require('../server_rpc');
const cluster_hb = require('../bg_services/cluster_hb');
const Dispatcher = require('../notifications/dispatcher');
const system_store = require('./system_store').get_instance();
const promise_utils = require('../../util/promise_utils');
const net_utils = require('../../util/net_utils');
const upgrade_utils = require('../../upgrade/upgrade_utils');
const phone_home_utils = require('../../util/phone_home');
const { RpcError, RPC_BUFFERS } = require('../../rpc');

// TODO: maybe we need to change it to use upgrade status in DB.
// currently use this memory only flag to indicate if upgrade is still in process
let upgrade_in_process = false;
let add_member_in_process = false;

const VERIFY_RESPONSE = [
    'OKAY',
    'SECRET_MISMATCH',
    'VERSION_MISMATCH',
    'ALREADY_A_MEMBER',
    'HAS_OBJECTS',
    'UNREACHABLE',
    'ADDING_SELF',
    'NO_NTP_SET'
];

function _init() {
    return P.resolve(MongoCtrl.init());
}

//
//API
//

//Return new cluster info, if doesn't exists in db
function new_cluster_info(params) {
    if (system_store.get_local_cluster_info()) {
        return;
    }

    return P.fcall(function() {
            var address = (params && params.address) || os_utils.get_local_ipv4_ips()[0];
            var cluster = {
                debug_level: 0,
                is_clusterized: false,
                owner_secret: system_store.get_server_secret(),
                cluster_id: system_store.get_server_secret(),
                owner_address: address,
                owner_shardname: 'shard1',
                location: 'DC1',
                shards: [{
                    shardname: 'shard1',
                    servers: [{
                        address: address //TODO:: on multiple nics support, fix this
                    }],
                }],
                config_servers: [],
                upgrade: {
                    status: 'COMPLETED',
                },
            };
            return cluster;
        })
        .then(cluster => _attach_server_configuration(cluster));
}

function init_cluster() {
    return cluster_hb.do_heartbeat();
}

//Initiate process of adding a server to the cluster
function add_member_to_cluster(req) {
    if (add_member_in_process) {
        throw new Error('Already in process of adding a member to the cluster');
    }
    add_member_in_process = true;
    dbg.log0('Recieved add member to cluster req', req.rpc_params, 'current topology',
        cutil.pretty_topology(cutil.get_topology()));

    return pre_add_member_to_cluster(req)
        .then(my_address => {
            add_member_to_cluster_invoke(req, my_address)
                .finally(() => {
                    add_member_in_process = false;
                });
        })
        .catch(err => {
            dbg.error(`got error on pre_add_member_to_cluster:`, err);
            add_member_in_process = false;
            throw err;
        });
}

function pre_add_member_to_cluster(req) {
    const topology = cutil.get_topology();
    const is_clusterized = topology.is_clusterized;
    let my_address;

    dbg.log0('validating member request');
    return _validate_member_request(req)
        .catch(err => {
            throw err;
        })
        .then(() => _check_candidate_version(req))
        .then(version_check_res => {
            if (version_check_res.result !== 'OKAY') throw new Error('Verify join version check returned', version_check_res);
        })
        .then(() => server_rpc.client.cluster_internal.verify_join_conditions({
            secret: req.rpc_params.secret,
        }, {
            address: server_rpc.get_base_address(req.rpc_params.address),
            timeout: 60000 //60s
        }))
        .then(response => {
            if (response.result !== 'OKAY') throw new Error(`Verify join conditions check returned ${response.result}`);
            dbg.log0('validating succeeded, got this caller_address', response.caller_address);
            my_address = response.caller_address || os_utils.get_local_ipv4_ips()[0];
            if (!is_clusterized && response && response.caller_address) {
                dbg.log0('updating adding server ip in db');
                let shard_idx = cutil.find_shard_index(req.rpc_params.shard);
                let server_idx = _.findIndex(topology.shards[shard_idx].servers,
                    server => server.address === '127.0.0.1');
                if (server_idx === -1) {
                    dbg.warn("db does not contain internal ip of master server");
                } else {
                    let new_shards = topology.shards;
                    new_shards[shard_idx].servers[server_idx] = {
                        address: response.caller_address
                    };
                    // if this is the first server in the cluster, adding the 2nd one we update the
                    // ip of this server to be the external ip instead of internal in cluster schema
                    return system_store.make_changes({
                        update: {
                            clusters: [{
                                _id: system_store.get_local_cluster_info()._id,
                                owner_address: response.caller_address,
                                shards: new_shards
                            }]
                        }
                    }).catch(err => dbg.warn("Failed to update adding-server's ip", err));
                }
            }
        })
        .then(() => my_address);
}

function add_member_to_cluster_invoke(req, my_address) {
    const topology = cutil.get_topology();
    const id = topology.cluster_id;
    const is_clusterized = topology.is_clusterized;
    const first_server = !is_clusterized;

    return P.fcall(function() {
            //If this is the first time we are adding to the cluster, special handling is required
            if (!is_clusterized) {
                dbg.log0('Current server is first on cluster and has single mongo running, updating');
                return _initiate_replica_set('shard1');
                //TODO:: when adding shard, the first server should also have its single mongo replaced to shard
                /*return _add_new_shard_on_server('shard1', myip, {
                    first_shard: true,
                    remote_server: false
                });*/
                //If adding shard, and current server does not have config on it, add
                //This is the case on the addition of the first shard
            }
        })
        .then(() => {
            dbg.log0(`read mongo certs from /etc/mongo_ssl/`);
            return P.join(
                fs.readFileAsync(config.MONGO_DEFAULTS.ROOT_CA_PATH, 'utf8'),
                fs.readFileAsync(config.MONGO_DEFAULTS.SERVER_CERT_PATH, 'utf8'),
                fs.readFileAsync(config.MONGO_DEFAULTS.CLIENT_CERT_PATH, 'utf8')
            );
        })
        .spread((root_ca, server_cert, client_cert) => {
            // after a cluster was initiated, join the new member
            dbg.log0('Sending join_to_cluster to', req.rpc_params.address, cutil.get_topology());
            //Send a join_to_cluster command to the new joining server
            return server_rpc.client.cluster_internal.join_to_cluster({
                ip: req.rpc_params.address,
                master_ip: my_address,
                topology: cutil.get_topology(),
                cluster_id: id,
                secret: req.rpc_params.secret,
                role: req.rpc_params.role,
                shard: req.rpc_params.shard,
                location: req.rpc_params.location,
                jwt_secret: process.env.JWT_SECRET,
                new_hostname: req.rpc_params.new_hostname,
                ssl_certs: { root_ca, server_cert, client_cert }
            }, {
                address: server_rpc.get_base_address(req.rpc_params.address),
                timeout: 2 * 60000 // 2 minutes timeout
            });
        })
        .then(res => {
            Dispatcher.instance().activity({
                event: 'cluster.added_member_to_cluster',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                server: {
                    hostname: req.rpc_params.new_hostname ||
                        _.get(system_store.data.cluster_by_server[req.rpc_params.secret],
                            'heartbeat.health.os_info.hostname'),
                    secret: req.rpc_params.secret
                },
                desc: `Server ${req.rpc_params.new_hostname || ''} added to cluster`,
            });
            return res;
        })
        .catch(function(err) {
            console.error('Failed adding members to cluster', req.rpc_params, 'with', err);
            Dispatcher.instance().alert('MAJOR',
                system_store.data.systems[0]._id,
                `Failed adding server ${req.rpc_params.new_hostname} to cluster`,
                null); // always
            throw new Error('Failed adding members to cluster');
        })
        // TODO: solve in a better way
        // added this delay, otherwise the next system_store.load doesn't catch the new servers HB
        .delay(500)
        .then(function() {
            dbg.log0('Added member', req.rpc_params.address, 'to cluster. New topology',
                cutil.pretty_topology(cutil.get_topology()));
            // reload system_store to update after new member HB
            return system_store.load();
        })
        // ugly but works. perform first heartbeat after server is joined, so UI will present updated data
        .then(() => cluster_hb.do_heartbeat())
        .then(() => {
            if (first_server) {
                return MongoCtrl.add_mongo_monitor_program();
            }
        })
        .then(() => Dispatcher.instance().publish_fe_notifications({
                secret: req.rpc_params.secret,
                result: true
            }, 'add_memeber_to_cluster') //send notification API on newly added member
        )
        .catch(err => {
            console.error(`Caught err in add_member_to_cluster_invoke ${err}`);
            return Dispatcher.instance().publish_fe_notifications({
                secret: req.rpc_params.secret,
                result: false,
                reason: err.toString()
            }, 'add_memeber_to_cluster');
        })
        .return();
}

function verify_join_conditions(req) {
    dbg.log0('Got verify_join_conditions request');
    return P.resolve()
        .then(() => os_utils.os_info(true))
        .then(os_info => {
            let hostname = os_info.hostname;
            let caller_address;
            if (req.connection && req.connection.url) {
                caller_address = req.connection.url.hostname.includes('ffff') ?
                    req.connection.url.hostname.replace(/^.*:/, '') :
                    req.connection.url.hostname;
            } else {
                dbg.error('No connection on request for verify_join_conditions. Got:', req);
                throw new Error('No connection on request for verify_join_conditions');
            }
            return _verify_join_preconditons(req)
                .catch(err => {
                    dbg.error('verify_join_conditions: HAD ERROR', err, err.message);
                    if (_.includes(VERIFY_RESPONSE, err.message)) return err.message;
                    throw err;
                })
                .then(result => ({
                    result,
                    caller_address,
                    hostname,
                }));
        });
}

function _check_candidate_version(req) {
    dbg.log0('_check_candidate_version for address', req.rpc_params.address);
    return server_rpc.client.cluster_internal.get_version(undefined, {
            address: server_rpc.get_base_address(req.rpc_params.address),
            timeout: 60000 //60s
        })
        .then(({ version }) => {
            dbg.log0('_check_candidate_version got version', version);
            if (version !== pkg.version) {
                return {
                    result: 'VERSION_MISMATCH',
                    version
                };
            }
            return {
                result: 'OKAY'
            };
        })
        .catch(RpcError, rpc_err => {
            if (rpc_err.rpc_code === 'NO_SUCH_RPC_SERVICE') {
                dbg.warn('_check_candidate_version got NO_SUCH_RPC_SERVICE from a server with an old version');
                // Called server is too old to have this code
                return {
                    result: 'VERSION_MISMATCH'
                };
            }
            throw rpc_err;
        });
}

function verify_candidate_join_conditions(req) {
    dbg.log0('Got verify_candidate_join_conditions for server secret:', req.rpc_params.secret,
        'address:', req.rpc_params.address);
    if (req.rpc_params.secret === system_store.get_server_secret()) {
        dbg.error('lol trying to add self to cluster - self secret received:', req.rpc_params.secret);
        return {
            result: 'ADDING_SELF'
        };
    }
    return _check_candidate_version(req)
        .then(version_check_res => {
            if (version_check_res.result !== 'OKAY') return version_check_res;
            return server_rpc.client.cluster_internal.verify_join_conditions({
                    secret: req.rpc_params.secret
                }, {
                    address: server_rpc.get_base_address(req.rpc_params.address),
                    timeout: 60000 //60s
                })
                .then(res => ({
                    hostname: res.hostname,
                    result: res.result,
                    version: version_check_res.version
                }));
        })
        .catch(RpcError, err => {
            if (err.rpc_code === 'RPC_CONNECT_TIMEOUT' ||
                err.rpc_code === 'RPC_REQUEST_TIMEOUT') {
                dbg.warn('received', err, ' on verify_candidate_join_conditions');
                return {
                    result: 'UNREACHABLE'
                };
            }
            throw err;
        });
}

function get_version(req) {
    dbg.log0('get_version sending version', pkg.version);
    return P.resolve()
        .then(() => ({
            version: pkg.version
        }));
}

function join_to_cluster(req) {
    dbg.log0('Got join_to_cluster request with topology', cutil.pretty_topology(req.rpc_params.topology),
        'existing topology is:', cutil.pretty_topology(cutil.get_topology()));
    return server_rpc.client.cluster_master.set_master_updates({ enabled: false })
        .then(() => _verify_join_preconditons(req)
            .catch(err => {
                dbg.error('join_to_cluster: HAD ERROR', err);
                return err.message;
            })
        )
        .then(verify_res => {
            if (verify_res !== 'OKAY') {
                throw new Error('Verify join preconditions failed with result', verify_res);
            }
            req.rpc_params.topology.owner_shardname = req.rpc_params.shard;
            req.rpc_params.topology.owner_address = req.rpc_params.ip;
            // update jwt secret in dotenv
            dbg.log0('updating JWT_SECRET in .env:', req.rpc_params.jwt_secret);
            dotenv.set({
                key: 'JWT_SECRET',
                value: req.rpc_params.jwt_secret
            });
            //TODO:: need to think regarding role switch: ReplicaSet chain vs. Shard (or switching between
            //different ReplicaSet Chains)
            //Easy path -> don't support it, make admin detach and re-attach as new role,
            //though this creates more hassle for the admin and overall lengthier process

            // first thing we update the new topology as the local topoology.
            // later it will be updated to hold this server's info in the cluster's DB
            return _update_cluster_info(req.rpc_params.topology);
        })
        .then(() => {
            dbg.log0(`overwrite mongo certs to /etc/mongo_ssl/`);
            return P.join(
                fs.writeFileAsync(config.MONGO_DEFAULTS.ROOT_CA_PATH, req.rpc_params.ssl_certs.root_ca),
                fs.writeFileAsync(config.MONGO_DEFAULTS.SERVER_CERT_PATH, req.rpc_params.ssl_certs.server_cert),
                fs.writeFileAsync(config.MONGO_DEFAULTS.CLIENT_CERT_PATH, req.rpc_params.ssl_certs.client_cert)
            );
        })
        .then(() => {
            if (req.rpc_params.new_hostname) {
                dbg.log0('setting hostname to ', req.rpc_params.new_hostname);
                os_utils.set_hostname(req.rpc_params.new_hostname);
            }
            dbg.log0('server new role is', req.rpc_params.role);
            if (req.rpc_params.role === 'SHARD') {
                //Server is joining as a new shard, update the shard topology
                let shards = cutil.get_topology().shards;
                shards.push({
                    shardname: req.rpc_params.shard,
                    servers: [{
                        address: req.rpc_params.ip
                    }]
                });
                let cluster_info = {
                    owner_address: req.rpc_params.ip,
                    shards: shards
                };
                if (req.rpc_params.location) {
                    dbg.log0('setting location tag to ', req.rpc_params.new_hostname);
                    cluster_info.location = req.rpc_params.location;
                }
                return P.resolve(_update_cluster_info(cluster_info))
                    .then(() => _add_new_shard_on_server(req.rpc_params.shard, req.rpc_params.ip, {
                        first_shard: false,
                        remote_server: true
                    }));
            } else if (req.rpc_params.role === 'REPLICA') {
                //Server is joining as a replica set member to an existing shard, update shard chain topology
                //And add an appropriate server
                return _add_new_server_to_replica_set({
                    shardname: req.rpc_params.shard,
                    ip: req.rpc_params.ip,
                    location: req.rpc_params.location
                });
            }
            dbg.error('Unknown role', req.rpc_params.role, 'recieved, ignoring');
            throw new Error('Unknown server role ' + req.rpc_params.role);
        })
        //.then(() => _attach_server_configuration({}))
        //.then((res_params) => _update_cluster_info(res_params))
        .then(function() {
            var topology_to_send = _.omit(cutil.get_topology(), 'dns_servers', 'ntp');
            dbg.log0('Added member, publishing updated topology', cutil.pretty_topology(topology_to_send));
            //Mongo servers are up, update entire cluster with the new topology
            return _publish_to_cluster('news_updated_topology', {
                new_topology: topology_to_send
            });
        })
        // ugly but works. perform first heartbeat after server is joined, so UI will present updated data
        .then(() => cluster_hb.do_heartbeat())
        // send update to all services with the master address
        .then(() => cutil.send_master_update(false, req.rpc_params.master_ip))
        // restart bg_workers and s3rver to fix stale data\connections issues. maybe we can do it in a more elgant way
        .then(() => _restart_services())
        .then(() => MongoCtrl.add_mongo_monitor_program())
        .finally(() => server_rpc.client.cluster_master.set_master_updates({ enabled: true }));
}

function verify_new_ip(req) {
    const address = server_rpc.get_base_address(req.rpc_params.address);
    console.log('verify_new_ip', address);
    return server_rpc.client.cluster_internal.get_secret({}, {
            address,
            timeout: 20000,
            connect_timeout: 20000,
        })
        .then(res => {
            if (res.secret === req.rpc_params.secret) {
                return {
                    result: 'OKAY'
                };
            } else {
                return {
                    result: 'SECRET_MISMATCH'
                };
            }
        })
        .catch(err => {
            dbg.warn('received', err, ' on verify_new_ip');
            if (err.rpc_code === 'RPC_CONNECT_TIMEOUT' ||
                err.rpc_code === 'RPC_REQUEST_TIMEOUT') {
                return {
                    result: 'UNREACHABLE'
                };
            } else {
                throw err;
            }
        });
}

// Currently only updates server's IP
// This function runs only at the master of cluster
function update_member_of_cluster(req) {
    let topology = cutil.get_topology();
    const is_clusterized = topology.is_clusterized;
    let old_address;
    // Shouldn't do anything if there is not cluster
    if (!(is_clusterized && system_store.is_cluster_master)) {
        dbg.log0(`update_member_of_cluster: is_clusterized:${is_clusterized},
            is_master:${system_store.is_cluster_master}`);
        return P.resolve();
    }
    const info = cutil.get_cluster_info();

    return _validate_member_request(_.defaults({
            rpc_params: {
                address: req.rpc_params.new_address,
                new_hostname: req.rpc_params.hostname
            },
            req
        }))
        .then(() => _check_candidate_version(_.defaults({
            rpc_params: {
                address: req.rpc_params.new_address,
                new_hostname: req.rpc_params.hostname
            },
            req
        })))
        .then(version_check_res => {
            if (version_check_res.result !== 'OKAY') throw new Error('Verify member version check returned', version_check_res);
        })
        .then(() => {
            let shard_index = -1;
            let server_idx = -1;
            for (let i = 0; i < info.shards.length; ++i) {
                server_idx = _.findIndex(info.shards[i].servers,
                    server => server.secret === req.rpc_params.target_secret);
                if (server_idx !== -1) {
                    shard_index = i;
                    break;
                }
            }
            if (shard_index === -1 || server_idx === -1) {
                throw new Error(`could not find address:${req.rpc_params.secret} in any shard`);
            }
            let new_shard = topology.shards[shard_index];
            old_address = new_shard.servers[server_idx].address;
            new_shard.servers[server_idx] = {
                address: req.rpc_params.new_address
            };

            let new_rs_params = {
                name: new_shard.shardname,
                IPs: cutil.extract_servers_ip(
                    new_shard.servers
                ),
                cluster_id: topology.cluster_id
            };
            // Publish change of replicaset to all servers in cluster
            // Only the master will update the rs config and .env mongo connection string
            // All of the other will only update .env mongo connection string
            return _publish_to_cluster('news_replicaset_servers', new_rs_params);
        })
        // Update current topology of the server
        .then(() => _update_cluster_info(topology))
        .then(() => {
            topology = cutil.get_topology();
            var topology_to_send = _.omit(topology, 'dns_servers', 'ntp');
            dbg.log0('Added member, publishing updated topology', cutil.pretty_topology(topology_to_send));
            // Mongo servers are up, update entire cluster with the new topology
            // Notice that we send additional parameters which will be used for the changed server
            // Server that had his IP changed needs to change the owner_address property in his cluster record
            // To use the new IP, in addition to changes in the shard servers
            return _publish_to_cluster('news_updated_topology', {
                new_topology: topology_to_send,
                cluster_member_edit: {
                    old_address: old_address,
                    new_address: req.rpc_params.new_address
                }
            });
        })
        // TODO: solve in a better way
        // added this delay, otherwise the next system_store.load doesn't catch the new servers HB
        .delay(1000)
        .then(function() {
            dbg.log0('Edited member', req.rpc_params.old_address, 'of cluster. New topology',
                cutil.pretty_topology(cutil.get_topology()));
            // reload system_store to update after edited member HB
            return system_store.load();
        })
        // ugly but works. perform first heartbeat after server was edited, so UI will present updated data
        .then(() => cluster_hb.do_heartbeat())
        .catch(function(err) {
            console.error('Failed edit of member to cluster', req.rpc_params, 'with', err);
            throw new Error('Failed edit of member to cluster');
        })
        .return();
}

function news_config_servers(req) {
    dbg.log0('Recieved news: news_config_servers', cutil.pretty_topology(req.rpc_params));
    //Verify we recieved news on the cluster we are joined to
    cutil.verify_cluster_id(req.rpc_params.cluster_id);
    //If config servers changed, update
    //Only the first server in the cfg array does so
    return P.resolve(_update_rs_if_needed(req.rpc_params.IPs, config.MONGO_DEFAULTS.CFG_RSET_NAME, true))
        .then(() => P.resolve(_update_cluster_info({
                config_servers: req.rpc_params.IPs
            }))
            .then(() => MongoCtrl.add_new_mongos(cutil.extract_servers_ip(
                    cutil.get_topology().config_servers
                ))
                //TODO:: Update connection string for our mongo connections, currently only seems needed for
                //Replica sets =>
                //Need to close current connections and re-open (bg_worker, all webservers)
                //probably best to use publish_to_cluster
            ));
}

function news_replicaset_servers(req) {
    dbg.log0('Recieved news: news_replicaset_servers', cutil.pretty_topology(req.rpc_params));
    //Verify we recieved news on the cluster we are joined to
    cutil.verify_cluster_id(req.rpc_params.cluster_id);
    dbg.log0('replica set params - IPs:', req.rpc_params.IPs, 'name:', req.rpc_params.name);
    return P.resolve(_update_rs_if_needed(req.rpc_params.IPs, req.rpc_params.name, false))
        .return();
}

function news_updated_topology(req) {
    dbg.log0('Recieved news: news_updated_topology', cutil.pretty_topology(req.rpc_params));
    const params = {
        is_clusterized: true,
        shards: req.rpc_params.new_topology.shards
    };
    //Verify we recieved news on the cluster we are joined to
    cutil.verify_cluster_id(req.rpc_params.new_topology.cluster_id);
    if (req.rpc_params.cluster_member_edit) {
        const current_clustering = system_store.get_local_cluster_info();
        if (String(current_clustering.owner_address) ===
            String(req.rpc_params.cluster_member_edit.old_address)) {
            params.owner_address = req.rpc_params.cluster_member_edit.new_address;
        }
    }

    dbg.log0('updating topology to the new published topology:', req.rpc_params.new_topology);
    //Update our view of the topology
    return P.resolve(_update_cluster_info(params));
}


function redirect_to_cluster_master(req) {
    let current_clustering = system_store.get_local_cluster_info();
    if (!current_clustering) {
        let address = system_store.data.systems[0].base_address || os_utils.get_local_ipv4_ips()[0];
        return address;
    }
    if (!current_clustering.is_clusterized) {
        let address = system_store.data.systems[0].base_address || current_clustering.owner_address;
        return address;
    }
    return P.fcall(function() {
            return MongoCtrl.redirect_to_cluster_master();
        })
        .catch(err => {
            dbg.log0('redirect_to_cluster_master caught error', err);
            let topology = cutil.get_topology();
            let res_host;
            if (topology && topology.shards) {
                _.forEach(topology.shards, shard => {
                    if (String(shard.shardname) === String(topology.owner_shardname)) {
                        let hosts_excluding_current = _.difference(shard.servers, [{
                            address: topology.owner_address
                        }]);
                        if (hosts_excluding_current.length > 0) {
                            res_host = hosts_excluding_current[Math.floor(Math.random() * hosts_excluding_current.length)];
                        }
                    }
                });
            }

            if (res_host) {
                return res_host.address;
            } else {
                throw new Error('Could not find server to redirect');
            }
        });
}


function update_time_config(req) {
    dbg.log0('update_time_config called with', req.rpc_params);
    const local_info = system_store.get_local_cluster_info(true);
    var time_config = req.rpc_params;
    var target_servers = [];
    let audit_desc = 'Server date and time successfully updated to: ';
    let audit_hostname;
    return P.resolve()
        .then(() => {
            if (time_config.ntp_server) {
                return os_utils.verify_ntp_server(time_config.ntp_server)
                    .catch(err => {
                        throw new RpcError(`Failed testing NTP ${time_config.ntp_server} with ${err}`);
                    });
            }
            return P.resolve();
        })
        .then(() => {
            if (time_config.target_secret) {
                let cluster_server = system_store.data.cluster_by_server[time_config.target_secret];
                if (!cluster_server) {
                    throw new RpcError('CLUSTER_SERVER_NOT_FOUND', 'Server with secret key:', time_config.target_secret, ' was not found');
                }
                target_servers.push(cluster_server);
                audit_hostname = _.get(cluster_server, 'heartbeat.health.os_info.hostname');
            } else {
                _.each(system_store.data.clusters, cluster => target_servers.push(cluster));
            }

            if (!time_config.ntp_server && !time_config.epoch) {
                throw new RpcError('CONFIG_NOT_FOUND', 'Missing time configuration (ntp_server or epoch)');
            }

            if (time_config.ntp_server && time_config.epoch) {
                throw new RpcError('DUAL_CONFIG', 'Dual configuration provided (ntp_server and epoch)');
            }

            if (local_info.is_clusterized && !target_servers.every(server => {
                    let server_status = _.find(local_info.heartbeat.health.mongo_rs_status.members, { name: server.owner_address + ':27000' });
                    return server_status && (server_status.stateStr === 'PRIMARY' || server_status.stateStr === 'SECONDARY');
                })) {
                throw new RpcError('OFFLINE_SERVER', 'Server is disconnected');
            }

            let config_to_update = {
                timezone: time_config.timezone
            };

            audit_desc += `Timezone: ${time_config.timezone}`;

            if (time_config.ntp_server) {
                audit_desc += `, NTP server address: ${time_config.ntp_server}`;
                config_to_update.server = time_config.ntp_server;
            }

            if (time_config.epoch) {
                audit_desc += `, epoch: ${time_config.epoch}`;
            }

            let updates = _.map(target_servers, server => ({
                _id: server._id,
                ntp: config_to_update
            }));

            return system_store.make_changes({
                update: {
                    clusters: updates,
                }
            });
        })
        .then(() => {
            dbg.log0('caliing apply_updated_time_config for', _.map(target_servers, srv => srv.owner_address));
            return P.each(target_servers, function(server) {
                return server_rpc.client.cluster_internal.apply_updated_time_config(time_config, {
                    address: server_rpc.get_base_address(server.owner_address)
                });
            });
        })
        .then(() => {
            Dispatcher.instance().activity({
                event: 'conf.server_date_time_updated',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                server: {
                    hostname: audit_hostname,
                    secret: time_config.target_secret
                },
                desc: audit_desc,
            });
        })
        .return();
}


function apply_updated_time_config(req) {
    var time_config = req.rpc_params;
    return P.fcall(function() {
            if (time_config.ntp_server) { //set NTP
                return os_utils.set_ntp(time_config.ntp_server, time_config.timezone);
            } else { //manual set
                return os_utils.set_manual_time(time_config.epoch, time_config.timezone);
            }
        })
        .return();
}


function update_dns_servers(req) {
    var dns_servers_config = req.rpc_params;
    var target_servers = [];
    const local_info = system_store.get_local_cluster_info(true);
    return P.fcall(function() {
            if (dns_servers_config.target_secret) {
                let cluster_server = system_store.data.cluster_by_server[dns_servers_config.target_secret];
                if (!cluster_server) {
                    throw new RpcError('CLUSTER_SERVER_NOT_FOUND', 'Server with secret key:',
                        dns_servers_config.target_secret, ' was not found');
                }
                target_servers.push(cluster_server);
            } else {
                let current;
                _.each(system_store.data.clusters, cluster => {
                    //Run current last since we restart the server, we want to make sure
                    //all other server were dispatched to
                    if (system_store.get_server_secret() === cluster.owner_secret) {
                        current = cluster;
                    } else {
                        target_servers.push(cluster);
                    }
                });
                if (current) {
                    target_servers.push(current);
                }
            }
            if (!dns_servers_config.dns_servers.every(net.isIPv4)) {
                throw new RpcError('MALFORMED_IP', 'Malformed dns configuration');
            }
            if (dns_servers_config.search_domains && !dns_servers_config.search_domains.every(net_utils.is_fqdn)) {
                throw new RpcError('MALFORMED_FQDN', 'Malformed dns configuration');
            }
            if (local_info.is_clusterized && !target_servers.every(server => {
                    let server_status = _.find(local_info.heartbeat.health.mongo_rs_status.members, { name: server.owner_address + ':27000' });
                    return server_status && (server_status.stateStr === 'PRIMARY' || server_status.stateStr === 'SECONDARY');
                })) {
                throw new RpcError('OFFLINE_SERVER', 'Server is disconnected');
            }
            const config_to_compare = [
                dns_servers_config.dns_servers || [],
                dns_servers_config.search_domains || []
            ];
            // don't update servers that already have the dame configuration
            target_servers = target_servers.filter(srv => {
                const { dns_servers = [], search_domains = [] } = srv;
                return !_.isEqual(config_to_compare, [dns_servers, search_domains]);
            });
            if (!target_servers.length) {
                dbg.log0(`DNS changes are the same as current configuration. skipping`);
                throw new Error('NO_CHANGE');
            }
            let updates = _.map(target_servers, server => _.omitBy({
                _id: server._id,
                dns_servers: dns_servers_config.dns_servers,
                search_domains: dns_servers_config.search_domains
            }, _.isUndefined));
            return system_store.make_changes({
                update: {
                    clusters: updates,
                }
            });
        })
        .then(() => P.each(target_servers, function(server) {
            return server_rpc.client.cluster_internal.apply_updated_dns_servers(dns_servers_config, {
                address: server_rpc.get_base_address(server.owner_address)
            });
        }))
        .then(() => {
            Dispatcher.instance().activity({
                event: 'conf.dns_servers',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                desc: _.isEmpty(dns_servers_config.dns_servers) ?
                    `DNS servers cleared` : `DNS servers set to: ${dns_servers_config.dns_servers.join(', ')}`
            });
        })
        .catch(err => {
            if (err.message !== 'NO_CHANGE') throw err;
        })
        .return();
}


function apply_updated_dns_servers(req) {
    return P.resolve()
        .then(() => os_utils.set_dns_and_search_domains(req.rpc_params.dns_servers, req.rpc_params.search_domains))
        .return();
}


function set_debug_level(req) {
    dbg.log0('Recieved set_debug_level req', req.rpc_params);
    var debug_params = req.rpc_params;
    var target_servers = [];
    let audit_activity = {};
    return P.fcall(function() {
            if (debug_params.target_secret) {
                let cluster_server = system_store.data.cluster_by_server[debug_params.target_secret];
                if (!cluster_server) {
                    throw new RpcError('CLUSTER_SERVER_NOT_FOUND', 'Server with secret key:', debug_params.target_secret, ' was not found');
                }
                audit_activity = {
                    event: 'dbg.set_server_debug_level',
                    server: {
                        hostname: _.get(cluster_server, 'heartbeat.health.os_info.hostname'),
                        secret: cluster_server.owner_secret
                    }
                };
                target_servers.push(cluster_server);
            } else {
                _.each(system_store.data.clusters, cluster => target_servers.push(cluster));
            }

            return P.each(target_servers, function(server) {
                return server_rpc.client.cluster_internal.apply_set_debug_level(debug_params, {
                    address: server_rpc.get_base_address(server.owner_address),
                    auth_token: req.auth_token
                });
            });
        })
        .then(() => {
            if (!debug_params.target_secret && req.system.debug_level !== debug_params.level) {
                Dispatcher.instance().activity(_.defaults(audit_activity, {
                    event: 'dbg.set_debug_level',
                    level: 'info',
                    system: req.system._id,
                    actor: req.account && req.account._id,
                    desc: `Debug level was set to ${debug_params.level ? 'high' : 'low'}`
                }));
            }
        })
        .return();
}


function apply_set_debug_level(req) {
    dbg.log0('Recieved apply_set_debug_level req', req.rpc_params);
    if (req.rpc_params.target_secret) {
        let cluster_server = system_store.data.cluster_by_server[req.rpc_params.target_secret];
        if (!cluster_server) {
            throw new RpcError('CLUSTER_SERVER_NOT_FOUND', 'Server with secret key:', req.rpc_params.target_secret, ' was not found');
        }
        if (cluster_server.debug_level === req.rpc_params.level) {
            dbg.log0('requested to set debug level to the same as current level. skipping..', req.rpc_params);
            return;
        }
    } else if (req.system.debug_level === req.rpc_params.level) {
        dbg.log0('requested to set debug level to the same as current level. skipping..', req.rpc_params);
        return;
    }

    return _set_debug_level_internal(req, req.rpc_params.level)
        .then(() => {
            if (req.rpc_params.level > 0) { //If level was set, remove it after 10m
                promise_utils.delay_unblocking(config.DEBUG_MODE_PERIOD) //10m
                    .then(() => _set_debug_level_internal(req, 0));
            }
        })
        .return();
}

function _restart_services() {
    dbg.log0(`restarting services: s3rver bg_workers hosted_agents`);
    // set timeout to restart services in 1 second
    setTimeout(() => {
        promise_utils.exec('supervisorctl restart s3rver bg_workers hosted_agents');
    }, 1000);
}


function _set_debug_level_internal(req, level) {
    dbg.log0('Recieved _set_debug_level_internal req', req.rpc_params, 'With Level', level);
    return server_rpc.client.redirector.publish_to_cluster({
            method_api: 'debug_api',
            method_name: 'set_debug_level',
            target: '', // required but irrelevant
            request_params: {
                level: level,
                module: 'core'
            }
        }, {
            auth_token: req.auth_token
        })
        .then(() => MongoCtrl.set_debug_level(level ? 5 : 0))
        .then(() => {
            var update_object = {};
            var debug_mode = level > 0 ? Date.now() : undefined;

            if (req.rpc_params.target_secret) {
                let cluster_server = system_store.data.cluster_by_server[req.rpc_params.target_secret];
                if (!cluster_server) {
                    throw new RpcError('CLUSTER_SERVER_NOT_FOUND', 'Server with secret key:',
                        req.rpc_params.target_secret, ' was not found');
                }
                if (level > 0) {
                    update_object.clusters = [{
                        _id: cluster_server._id,
                        debug_level: level,
                        debug_mode: debug_mode
                    }];
                } else {
                    update_object.clusters = [{
                        _id: cluster_server._id,
                        $set: {
                            debug_level: level
                        },
                        $unset: {
                            debug_mode: true
                        }
                    }];
                }
            } else {
                // Only master can update the whole system debug mode level
                // TODO: If master falls in the process and we already passed him
                // It means that nobody will update the system in the DB, yet it will be in debug
                let current_clustering = system_store.get_local_cluster_info();
                if ((current_clustering && current_clustering.is_clusterized) && !system_store.is_cluster_master) {
                    return;
                }
                if (level > 0) {
                    update_object.systems = [{
                        _id: req.system._id,
                        debug_level: level,
                        debug_mode: debug_mode
                    }];
                } else {
                    update_object.systems = [{
                        _id: req.system._id,
                        $set: {
                            debug_level: level
                        },
                        $unset: {
                            debug_mode: true
                        }
                    }];
                }
            }

            return system_store.make_changes({
                update: update_object
            });
        });
}


function diagnose_system(req) {
    var target_servers = [];
    const TMP_WORK_DIR = `/tmp/cluster_diag`;
    const INNER_PATH = `${process.cwd()}/build`;
    const OUT_PATH = '/public/' + req.system.name + '_cluster_diagnostics.tgz';
    const WORKING_PATH = `${INNER_PATH}${OUT_PATH}`;
    if (req.rpc_params.target_secret) {

        let cluster_server = system_store.data.cluster_by_server[req.rpc_params.target_secret];
        if (!cluster_server) {
            throw new RpcError('CLUSTER_SERVER_NOT_FOUND', 'Server with secret key:', req.rpc_params.target_secret, ' was not found');
        }
        target_servers.push(cluster_server);
    } else {
        _.each(system_store.data.clusters, cluster => target_servers.push(cluster));
    }

    //In cases of a single server, address might not be publicly available and so using it might fail
    //This case does not happen when clusterized, but as a WA for a single server, use localhost (see #2803)
    if (!system_store.get_local_cluster_info().is_clusterized) {
        target_servers[0].owner_address = '127.0.0.1';
    }

    Dispatcher.instance().activity({
        event: 'dbg.diagnose_system',
        level: 'info',
        system: req.system._id,
        actor: req.account && req.account._id,
        desc: `${req.system.name} diagnostics package was exported by ${req.account && req.account.email}`,
    });

    return fs_utils.create_fresh_path(`${TMP_WORK_DIR}`)
        .then(() => P.map(target_servers, function(server) {
            return server_rpc.client.cluster_internal.collect_server_diagnostics({}, {
                    address: server_rpc.get_base_address(server.owner_address),
                    auth_token: req.auth_token
                })
                .then(res_data => {
                    const data = (res_data[RPC_BUFFERS] && res_data[RPC_BUFFERS].data) || '';
                    if (!data) dbg.warn('diagnose_system: no diagnostics data from ', server.owner_address);
                    const server_hostname = (server.heartbeat && server.heartbeat.health.os_info.hostname) || 'unknown';
                    // Should never exist since above we delete the root folder
                    return fs_utils.create_fresh_path(`${TMP_WORK_DIR}/${server_hostname}_${server.owner_secret}`)
                        .then(() => fs.writeFileAsync(
                            `${TMP_WORK_DIR}/${server_hostname}_${server.owner_secret}/diagnostics.tgz`,
                            data
                        ));
                });
        }))
        .then(() => promise_utils.exec(`find ${TMP_WORK_DIR} -maxdepth 1 -type f -delete`))
        .then(() => diag.pack_diagnostics(WORKING_PATH, TMP_WORK_DIR))
        .then(() => (OUT_PATH));
}


function collect_server_diagnostics(req) {
    const INNER_PATH = `${process.cwd()}/build`;
    return P.resolve()
        .then(() => os_utils.os_info(true))
        .then(os_info => {
            dbg.log0('Recieved diag req');
            var out_path = '/public/' + os_info.hostname + '_srv_diagnostics.tgz';
            var inner_path = process.cwd() + '/build' + out_path;
            return P.resolve()
                .then(() => diag.collect_server_diagnostics(req))
                .then(() => diag.pack_diagnostics(inner_path))
                .then(res => out_path);
        })
        .then(out_path => {
            dbg.log1('Reading packed file');
            return fs.readFileAsync(`${INNER_PATH}${out_path}`)
                .then(data => ({
                    [RPC_BUFFERS]: { data }
                }))
                .catch(err => {
                    dbg.error('DIAGNOSTICS READ FAILED', err.stack || err);
                    throw new Error('Server Collect Diag Error on reading packges diag file');
                });
        })
        .then(res => {
            Dispatcher.instance().activity({
                event: 'dbg.diagnose_server',
                level: 'info',
                actor: req.account && req.account._id,
                system: req.system._id,
                desc: `Collecting server diagnostics`,
            });
            return res;
        })
        .catch(err => {
            dbg.error('DIAGNOSTICS READ FAILED', err.stack || err);
            return {};
        });
}


function read_server_time(req) {
    let cluster_server = system_store.data.cluster_by_server[req.rpc_params.target_secret];
    if (!cluster_server) {
        throw new RpcError('CLUSTER_SERVER_NOT_FOUND', 'Server with secret key:', req.rpc_params.target_secret, ' was not found');
    }

    return server_rpc.client.cluster_internal.apply_read_server_time(req.rpc_params, {
        address: server_rpc.get_base_address(cluster_server.owner_address),
    });
}


function apply_read_server_time(req) {
    return moment().unix();
}


// UPGRADE ////////////////////////////////////////////////////////
function member_pre_upgrade(req) {
    dbg.log0('UPGRADE: received upgrade package:, ', req.rpc_params.filepath, req.rpc_params.mongo_upgrade ?
        'this server should preform mongo_upgrade' :
        'this server should not preform mongo_upgrade');
    let server = system_store.get_local_cluster_info(); //Update path in DB
    dbg.log0('update upgrade for server: ', cutil.get_cluster_info().owner_address);
    let upgrade = _.omitBy({
        path: req.rpc_params.filepath,
        mongo_upgrade: req.rpc_params.mongo_upgrade,
        status: req.rpc_params.stage === 'UPGRADE_STAGE' ? 'PRE_UPGRADE_PENDING' : 'PENDING',
        package_uploaded: req.rpc_params.stage === 'UPLOAD_STAGE' ? Date.now() : server.upgrade.package_uploaded,
        staged_package: req.rpc_params.stage === 'UPLOAD_STAGE' ? 'UNKNOWN' : server.upgrade.staged_package
    }, _.isUndefined);

    dbg.log0('UPGRADE:', 'updating cluster for server._id', server._id, 'with upgrade =', upgrade);

    return system_store.make_changes({
            update: {
                clusters: [{
                    _id: server._id,
                    upgrade: upgrade
                }]
            }
        })
        .then(() => Dispatcher.instance().publish_fe_notifications({ secret: system_store.get_server_secret() }, 'change_upgrade_status'))
        .then(() => upgrade_utils.pre_upgrade({
            upgrade_path: upgrade.path,
            extract_package: req.rpc_params.stage === 'UPLOAD_STAGE'
        }))
        .then(res => {
            //Update result of pre_upgrade and message in DB
            if (res.result) {
                dbg.log0('UPGRADE:', 'get res.result =', res.result, ' setting status to CAN_UPGRADE');
                upgrade.status = req.rpc_params.stage === 'UPGRADE_STAGE' ? 'PRE_UPGRADE_READY' : 'CAN_UPGRADE';
            } else {
                dbg.log0('UPGRADE:', 'get res.result =', res.result, ' setting status to FAILED');
                upgrade.status = 'FAILED';
                dbg.error('UPGRADE HAD ERROR: ', res.error);
                // TODO: Change that shit to more suitable error handler
                upgrade.error = res.error;
                if (req.rpc_params.stage === 'UPGRADE_STAGE') {
                    upgrade_in_process = false;
                }
            }

            if (req.rpc_params.stage === 'UPLOAD_STAGE') {
                upgrade.staged_package = res.staged_package || 'UNKNOWN';
            }
            upgrade.tested_date = res.tested_date;

            dbg.log0('UPGRADE:', 'updating cluster again for server._id', server._id, 'with upgrade =', upgrade);

            return system_store.make_changes({
                update: {
                    clusters: [{
                        _id: server._id,
                        upgrade: upgrade
                    }]
                }
            });
        })
        .then(() => Dispatcher.instance().publish_fe_notifications({ secret: system_store.get_server_secret() }, 'change_upgrade_status'))
        .return();
}

function do_upgrade(req) {
    system_store.load()
        .then(() => {
            dbg.log0('UPGRADE:', 'got do_upgrade');
            let server = system_store.get_local_cluster_info();
            if (server.upgrade.status !== 'UPGRADING') {
                dbg.error('Not in upgrade state:', ' State Is: ', server.upgrade.status || 'NO_STATUS');
                throw new Error('Not in upgrade state:', server.upgrade.error ? server.upgrade.error : '',
                    ' State Is: ', server.upgrade.status || 'NO_STATUS');
            }
            if (server.upgrade.path === '') {
                dbg.error('No package path supplied');
                throw new Error('No package path supplied');
            }
            let filepath = server.upgrade.path;
            //Async as the server will soon be restarted anyway
            const on_err = err => {
                dbg.error('upgrade scripted failed. Aborting upgrade:', err);
                upgrade_in_process = false;
                _handle_cluster_upgrade_failure(err, server.owner_address);
            };
            upgrade_utils.do_upgrade(filepath, server.is_clusterized, on_err);
        });
}


function get_upgrade_status(req) {
    return { in_process: upgrade_in_process };
}

function cluster_pre_upgrade(req) {
    dbg.log0('cluster_pre_upgrade:', cutil.pretty_topology(cutil.get_topology()));
    // get all cluster members other than the master
    const cinfo = system_store.get_local_cluster_info();
    const upgrade_path = req.rpc_params.filepath || _get_upgrade_path();

    return P.resolve()
        .then(() => {
            if (!upgrade_path) {
                throw new Error('cluster_pre_upgrade: must include path');
            }
            const secondary_members = cutil.get_all_cluster_members().filter(ip => ip !== cinfo.owner_address);
            dbg.log0('cluster_pre_upgrade:', 'secondaries =', secondary_members);

            return P.fcall(() => {
                    if (cinfo.is_clusterized) {
                        return MongoCtrl.is_master()
                            .then(res => res.ismaster);
                    }
                    return true;
                })
                .then(is_master => {
                    if (!is_master) {
                        throw new Error('cluster_pre_upgrade: upgrade must be done on master node');
                    }

                    dbg.log0('cluster_pre_upgrade:', 'calling member_pre_upgrade');
                    server_rpc.client.cluster_internal.member_pre_upgrade({
                            filepath: upgrade_path,
                            mongo_upgrade: false,
                            stage: req.rpc_params.filepath ? 'UPLOAD_STAGE' : 'RETEST_STAGE'
                        })
                        .catch(err => {
                            dbg.error('cluster_pre_upgrade:', 'pre_upgrade failed on master - aborting upgrade', err);
                            throw err;
                        });
                })
                .then(() => {
                    // upload package to secondaries
                    dbg.log0('cluster_pre_upgrade:', 'uploading package to all cluster members');
                    // upload package to cluster members
                    return P.all(secondary_members.map(ip => _upload_package(upgrade_path, ip)
                        .catch(err => {
                            dbg.error('upgrade_cluster failed uploading package', err);
                            return _handle_cluster_upgrade_failure(new Error('DISTRIBUTION_FAILED'), ip);
                        })
                    ));
                });
        })
        .return();
}

function upgrade_cluster(req) {
    dbg.log0('UPGRADE got request to upgrade the cluster:', cutil.pretty_topology(cutil.get_topology()));
    // get all cluster members other than the master
    let cinfo = system_store.get_local_cluster_info();
    if (cinfo.upgrade.status !== 'CAN_UPGRADE' && cinfo.upgrade.status !== 'UPGRADE_FAILED') {
        throw new Error('Not in upgrade state:', cinfo.upgrade.error ? cinfo.upgrade.error : '');
    }
    const upgrade_path = _get_upgrade_path();
    let secondary_members = cutil.get_all_cluster_members().filter(ip => ip !== cinfo.owner_address);
    dbg.log0('UPGRADE:', 'secondaries =', secondary_members);
    // upgrade can only be called from master. throw error otherwise
    upgrade_in_process = true;
    return P.fcall(() => {
            if (cinfo.is_clusterized) {
                return MongoCtrl.is_master()
                    .then(res => res.ismaster);
            }
            return true;
        })
        .then(is_master => {
            if (!is_master) {
                throw new Error('UPGRADE upgrade must be done on master node');
            }
        })
        .then(() => {
            const updates = system_store.data.clusters.map(cluster => ({
                _id: cluster._id,
                $set: {
                    "upgrade.initiator_email": req.account.email,
                    // This is a patch that was done in order so the FE won't wait for tests prior to upgrade
                    // We set this once again inside the member_pre_upgrade
                    "upgrade.status": 'PRE_UPGRADE_PENDING'
                },
                $unset: {
                    "upgrade.error": 1
                }
            }));
            return system_store.make_changes({
                update: {
                    clusters: updates
                }
            });
        })
        .then(() => {
            // Notice that we do not return here on purpose so the FE won't wait for the completion of the tests
            P.resolve()
                // .then(() => Dispatcher.instance().publish_fe_notifications({}, 'change_upgrade_status'))
                .then(() => {
                    // upload package to secondaries
                    dbg.log0('UPGRADE:', 'testing package in all secondary cluster members');
                    // upload package to cluster members
                    return P.all(secondary_members.map(ip => server_rpc.client.cluster_internal.member_pre_upgrade({
                            filepath: system_store.data.clusters.find(cluster => (String(cluster.owner_address) === String(ip))).upgrade.path,
                            mongo_upgrade: false,
                            stage: 'UPGRADE_STAGE'
                        }, {
                            address: server_rpc.get_base_address(ip),
                        })
                        .catch(err => {
                            dbg.error('upgrade_cluster failed uploading package', err);
                            return _handle_cluster_upgrade_failure(new Error('DISTRIBUTION_FAILED'), ip);
                        })
                    ));
                })
                .then(() => {
                    dbg.log0('UPGRADE:', 'calling member_pre_upgrade');
                    return server_rpc.client.cluster_internal.member_pre_upgrade({
                            filepath: upgrade_path,
                            mongo_upgrade: true,
                            stage: 'UPGRADE_STAGE'
                        })
                        .catch(err => {
                            dbg.error('UPGRADE:', 'pre_upgrade failed on master - aborting upgrade', err);
                            throw err;
                        });
                })
                .then(() => {
                    //wait for all secondaries to reach PRE_UPGRADE_READY. if one failed fail the upgrade
                    dbg.log0('UPGRADE:', 'waiting for secondaries to reach PRE_UPGRADE_READY');
                    // TODO: on multiple shards we can upgrade one at the time in each shard
                    return P.map(cutil.get_all_cluster_members(), ip => {
                        // for each server, wait for it to reach PRE_UPGRADE_READY, then call do_upgrade
                        // wait for UPGRADED status before continuing to next one
                        dbg.log0('UPGRADE:', 'waiting for server', ip, 'to reach PRE_UPGRADE_READY');
                        return _wait_for_upgrade_state(ip, 'PRE_UPGRADE_READY')
                            .catch(err => {
                                dbg.error('UPGRADE:', 'timeout: server at', ip, 'did not reach PRE_UPGRADE_READY state. aborting upgrade', err);
                                throw err;
                            });
                    });
                })
                .then(() => {
                    Dispatcher.instance().activity({
                        event: 'conf.system_upgrade_started',
                        level: 'info',
                        system: req.system._id,
                        actor: req.account && req.account._id,
                    });

                    //Update all clusters upgrade section with the new status and clear the error if exists
                    const cluster_updates = system_store.data.clusters.map(cluster => ({
                        _id: cluster._id,
                        $set: {
                            "upgrade.status": 'UPGRADING'
                        },
                        $unset: {
                            "upgrade.error": true
                        }
                    }));
                    //set last upgrade initiator under system
                    const system_updates = [{
                        _id: req.system._id,
                        $set: {
                            "last_upgrade.initiator": (req.account && req.account.email) || ''
                        }
                    }];
                    return system_store.make_changes({
                        update: {
                            clusters: cluster_updates,
                            systems: system_updates
                        }
                    });
                })
                // TODO: I've currently relying that this will not fail
                .then(() => Dispatcher.instance().publish_fe_notifications({}, 'change_upgrade_status'))
                // after all servers reached PRE_UPGRADE_READY, start upgrading secondaries one by one
                .then(() => _handle_upgrade_stage({ secondary_members, upgrade_path }));
        });
}

function _handle_cluster_upgrade_failure(err, ip) {
    return P.resolve()
        .then(() => {
            dbg.error('_handle_cluster_upgrade_failure: got error on cluster upgrade', err);
            upgrade_in_process = false;
            const fe_notif_params = {};
            const change = {
                "upgrade.status": 'UPGRADE_FAILED',
                "upgrade.error": 'Upgrade has failed with an interal error.'
            };
            let updates;
            if (ip) {
                updates = [{
                    _id: system_store.data.clusters.find(cluster => {
                        if (String(cluster.owner_address) === String(ip)) {
                            fe_notif_params.secret = cluster.owner_secret;
                            return true;
                        }
                        return false;
                    })._id,
                    $set: change
                }];
            } else {
                updates = system_store.data.clusters.map(cluster => ({
                    _id: cluster._id,
                    $set: change
                }));
            }
            return system_store.make_changes({
                    update: {
                        clusters: updates
                    }
                })
                .then(() => Dispatcher.instance().publish_fe_notifications(fe_notif_params, 'change_upgrade_status'))
                .finally(() => {
                    throw err;
                });
        });
}

function _handle_upgrade_stage(params) {
    // We do not return on purpose!
    P.each(params.secondary_members, ip => {
            dbg.log0('UPGRADE:', 'sending do_upgrade to server', ip, 'and and waiting for DB_READY state');
            return server_rpc.client.cluster_internal.do_upgrade({}, {
                    address: server_rpc.get_base_address(ip)
                })
                .then(() => _wait_for_upgrade_stage(ip, 'DB_READY'))
                .then(() => Dispatcher.instance().publish_fe_notifications({
                    secret: system_store.data.clusters.find(cluster => (String(cluster.owner_address) === String(ip))).owner_secret
                }, 'change_upgrade_status'))
                .catch(err => {
                    dbg.error('UPGRADE:', 'got error on upgrade of server', ip, 'aborting upgrade process', err);
                    return _handle_cluster_upgrade_failure(err, ip);
                });
        })
        // after all secondaries are upgraded it is safe to upgrade the primary.
        // secondaries should wait (in upgrade.js) for primary to complete upgrade and perform mongo_upgrade
        .then(() => {
            dbg.log0('UPGRADE:', 'calling do_upgrade on master');
            return server_rpc.client.cluster_internal.do_upgrade({
                filepath: params.upgrade_path
            });
        })
        .then(() => Dispatcher.instance().publish_fe_notifications({ secret: system_store.get_server_secret() }, 'change_upgrade_status'))
        .catch(err => {
            dbg.error('_handle_upgrade_stage got error on cluster upgrade', err);
            upgrade_in_process = false;
        });
}

function _wait_for_upgrade_state(ip, state) {
    let max_retries = 60;
    const upgrade_retry_delay = 10 * 1000; // the delay between testing upgrade status
    return promise_utils.retry(max_retries, upgrade_retry_delay, () => system_store.load()
        .then(() => {
            dbg.log0('UPGRADE:', 'wating for', ip, 'to reach', state);
            let status = cutil.get_member_upgrade_status(ip);
            dbg.log0('UPGRADE:', 'got status:', status);
            if (status !== state) {
                dbg.error('UPGRADE:', 'timedout waiting for ' + ip + ' to reach ' + state);
                if (status === 'FAILED') max_retries = 0;
                throw new Error('timedout waiting for ' + ip + ' to reach ' + state);
            }
        })
    );
}

function _wait_for_upgrade_stage(ip, stage_req) {
    let max_retries = 60;
    const upgrade_retry_delay = 10 * 1000; // the delay between testing upgrade status
    return promise_utils.retry(max_retries, upgrade_retry_delay, () => system_store.load()
        .then(() => {
            dbg.log0('UPGRADE:', 'wating for', ip, 'to reach', stage_req);
            let stage = cutil.get_member_upgrade_stage(ip);
            dbg.log0('UPGRADE:', 'got stage:', stage);
            if (stage !== stage_req) {
                dbg.error('UPGRADE:', 'timedout waiting for ' + ip + ' to reach ' + stage_req);
                // if (stage === 'FAILED') max_retries = 0;
                throw new Error('timedout waiting for ' + ip + ' to reach ' + stage_req);
            }
        })
    );
}

//
//Internals Cluster Control
//

function _upload_package(pkg_path, ip) {
    var formData = {
        upgrade_file: {
            value: fs.createReadStream(pkg_path),
            options: {
                filename: 'noobaa.tar.gz',
                contentType: 'application/x-gzip'
            }
        }
    };
    let target = url.format({
        protocol: 'http',
        slashes: true,
        hostname: ip,
        port: process.env.PORT,
        pathname: 'upload_package'
    });
    return P.ninvoke(request, 'post', {
            url: target,
            formData: formData,
            rejectUnauthorized: false,
        })
        .then((httpResponse, body) => {
            console.log('Upload package successful:', body);
        });
}


function read_server_config(req) {
    const { test_ph_connectivity = false, ph_proxy } = req.rpc_params;
    const proxy = ph_proxy && `http://${ph_proxy.address}:${ph_proxy.port}`;
    let using_dhcp = false;
    let srvconf = {};

    return P.resolve()
        .then(() => _attach_server_configuration(srvconf))
        .then(() => {
            if (DEV_MODE) {
                return 'CONNECTED';
            }

            return phone_home_utils.verify_connection_to_phonehome({ proxy }, test_ph_connectivity);
        })
        .then(connection_reply => {
            const phone_home_connectivity_status =
                (test_ph_connectivity && connection_reply) ||
                (connection_reply !== 'CONNECTED' && 'WAS_NOT_TESTED') ||
                'CONNECTED';

            if (phone_home_connectivity_status === 'CONNECTED' && ph_proxy) {
                dotenv.set({
                    key: 'PH_PROXY',
                    value: proxy
                });
            }

            const { dns_servers, search_domains, ntp = {} } = srvconf;
            const { timezone, server } = ntp;
            const used_proxy = ph_proxy;

            return _get_aws_owner()
                .then(owner => ({
                    phone_home_connectivity_status,
                    using_dhcp,
                    dns_servers,
                    search_domains,
                    timezone,
                    ntp_server: server,
                    used_proxy
                }));
        });
}

function update_server_conf(req) {
    dbg.log0('set_server_conf. params:', req.rpc_params);
    const cluster_server = system_store.data.cluster_by_server[req.rpc_params.target_secret];
    if (!cluster_server) {
        throw new Error('unknown server: ' + req.rpc_params.target_secret);
    }

    let audit_desc = ``;
    let audit_server = {};
    return P.resolve()
        .then(() => {
            audit_server.hostname = _.get(cluster_server, 'heartbeat.health.os_info.hostname');
            audit_server.secret = cluster_server.owner_secret;
            if (req.rpc_params.hostname &&
                req.rpc_params.hostname !== audit_server.hostname) { //hostname supplied and actually changed
                audit_desc += `Hostname changed from ${audit_server.hostname} to ${req.rpc_params.hostname}. `;
                audit_server.hostname = req.rpc_params.hostname;
                if (!os_utils.is_valid_hostname(req.rpc_params.hostname)) throw new Error(`Invalid hostname: ${req.rpc_params.hostname}. See RFC 1123`);
                return server_rpc.client.cluster_internal.set_hostname_internal({
                        hostname: req.rpc_params.hostname,
                    }, {
                        address: server_rpc.get_base_address(cluster_server.owner_address),
                        timeout: 60000 //60s
                    })
                    .then(() => cluster_hb.do_heartbeat()) //We call for HB since the hostname changed
                    .then(() => cluster_server);
            }
            return cluster_server;
        })
        .then(() => {
            if (req.rpc_params.location !== cluster_server.location) { //location supplied and actually changed
                const new_name = req.rpc_params.location ? req.rpc_params.location : "''";
                audit_desc += `Location tag set to ${new_name}.`;
                return system_store.make_changes({
                    update: {
                        clusters: [{
                            _id: cluster_server._id,
                            location: req.rpc_params.location ? req.rpc_params.location : ''
                        }]
                    }
                });
            }
        })
        .then(() => {
            if (!audit_desc) return P.resolve();
            Dispatcher.instance().activity({
                event: 'cluster.set_server_conf',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                server: audit_server,
                desc: audit_desc,
            });
        })
        .return();
}

function set_hostname_internal(req) {
    return os_utils.set_hostname(req.rpc_params.hostname);
}

//
//Internals Cluster Control
//
function _validate_member_request(req) {
    if (!os_utils.is_supervised_env()) {
        console.warn('Environment is not a supervised one, currently not allowing clustering operations');
        throw new Error('Environment is not a supervised one, currently not allowing clustering operations');
    }

    if (req.rpc_params.address && !net.isIPv4(req.rpc_params.address)) {
        throw new Error('Adding new members to cluster is allowed by using IP only');
    }

    if (req.rpc_params.new_hostname && !os_utils.is_valid_hostname(req.rpc_params.new_hostname)) {
        throw new Error(`Invalid hostname: ${req.rpc_params.new_hostname}. See RFC 1123`);
    }

    //Check mongo port 27000
    //TODO on sharding will also need to add verification to the cfg port
    return promise_utils.exec(`echo -n | nc -w1 ${req.rpc_params.address} ${config.MONGO_DEFAULTS.SHARD_SRV_PORT} >/dev/null 2>&1`)
        .then(() => P.resolve())
        .catch(() => P.resolve()) //Error in this case still means no FW dropped us on the way
        .timeout(30 * 1000)
        .catch(() => {
            throw new Error(`Could not reach ${req.rpc_params.address}:${config.MONGO_DEFAULTS.SHARD_SRV_PORT},
            might be due to a FW blocking`);
        })
        .then(() => os_utils.get_ntp())
        .then(platform_ntp => {
            if (!platform_ntp) {
                throw new Error('Could not add members when NTP is not set');
            }
        });
}

function get_secret(req) {
    return P.resolve()
        .then(() => {
            dbg.log0('_get_secret');
            return {
                secret: system_store.get_server_secret()
            };
        });
}

function _verify_join_preconditons(req) {
    return P.resolve()
        .then(() => {
            dbg.log0('_verify_join_preconditons');
            //Verify secrets match
            if (req.rpc_params.secret !== system_store.get_server_secret()) {
                dbg.error('Secrets do not match!');
                return 'SECRET_MISMATCH';
            }

            return os_utils.get_ntp()
                .then(platform_ntp => {
                    if (!platform_ntp) {
                        throw new Error('NO_NTP_SET');
                    }

                    let system = system_store.data.systems[0];
                    if (system) {
                        //Verify we are not already joined to a cluster
                        //TODO:: think how do we want to handle it, if at all
                        if (cutil.get_topology().shards.length !== 1 ||
                            cutil.get_topology().shards[0].servers.length !== 1) {
                            dbg.error('Server already joined to a cluster');
                            throw new Error('ALREADY_A_MEMBER');
                        }

                        // verify there are no objects on the system
                        return MDStore.instance().has_any_objects_in_system(system._id)
                            .then(has_objects => {
                                if (has_objects) {
                                    throw new Error('HAS_OBJECTS');
                                }
                            });
                    }
                })
                .then(() => {
                    // If we do not need system in order to add a server to a cluster
                    dbg.log0('_verify_join_preconditons okay. server has no system');
                    return 'OKAY';
                })
                .catch(err => {
                    dbg.warn('failed _verify_join_preconditons on', err.message);
                    throw err;
                });
        });
}

function _add_new_shard_on_server(shardname, ip, params) {
    // "cache" current topology until all changes take affect, since we are about to lose mongo
    // until the process is done
    let current_topology = cutil.get_topology();
    var config_updates = {};
    dbg.log0('Adding shard, new topology', cutil.pretty_topology(current_topology));

    //Actually add a new mongo shard instance
    return P.resolve(MongoCtrl.add_new_shard_server(shardname, params.first_shard))
        .then(function() {
            dbg.log0('Checking current config servers set, currently contains',
                current_topology.config_servers.length, 'servers');
            if (current_topology.config_servers.length === 3) { //Currently stay with a repset of 3 for config
                dbg.log0('Adding a new mongos without chanding the config array');
                //We already have a config replica set of 3, simply set up a mongos instance
                return MongoCtrl.add_new_mongos(cutil.extract_servers_ip(
                    current_topology.config_servers
                ));
            } else { // < 3 since we don't add once we reach 3, add this server as config as well
                dbg.log0('Adding a new config server', ip, 'to the config array', current_topology.config_servers);
                config_updates.config_servers = current_topology.config_servers;
                config_updates.config_servers.push({
                    address: ip
                });

                return _add_new_config_on_server(cutil.extract_servers_ip(config_updates.config_servers), params);
            }
        })
        .then(function() {
            dbg.log0('Adding shard to mongo shards');
            //add the new shard in the mongo configuration
            return P.resolve(MongoCtrl.add_member_shard(shardname, ip));
        })
        .then(function() {
            if (!params.first_shard) {
                //Write back old topology, was lost on transition to new shard server
                dbg.log0('Writing back old topology, for owner_secret reference', cutil.pretty_topology(current_topology));
                current_topology._id = system_store.generate_id();
                return system_store.make_changes({
                    insert: {
                        clusters: [current_topology]
                    }
                });
            }
        })
        .then(function() {
            if (config_updates.config_servers) {
                dbg.log0('Added', ip, 'as a config server publish to cluster');
                return _publish_to_cluster('news_config_servers', {
                    IPs: config_updates.config_servers,
                    cluster_id: current_topology.cluster_id
                });
            }
        });
}

function _initiate_replica_set(shardname) {
    dbg.log0('Adding first RS server to', shardname);
    var new_topology = cutil.get_topology();
    var shard_idx;
    shard_idx = cutil.find_shard_index(shardname);
    //No Such shard
    if (shard_idx === -1) {
        dbg.log0('Cannot add RS member to non-existing shard');
        throw new Error('Cannot add RS member to non-existing shard');
    }

    new_topology.is_clusterized = true;
    new_topology.owner_shardname = shardname;

    // first update topology to indicate clusterization
    return P.resolve(() => _update_cluster_info(new_topology))
        .then(() => MongoCtrl.add_replica_set_member(shardname, /*first_server=*/ true, new_topology.shards[shard_idx].servers))
        .then(() => {
            dbg.log0('Replica set created and initiated');
        });
}

function _update_cluster_info(params) {
    let current_clustering = system_store.get_local_cluster_info();
    return P.resolve()
        .then(() => {
            if (!current_clustering) {
                return new_cluster_info();
            }
        })
        .then(new_clustering => {
            current_clustering = current_clustering || new_clustering;
            var update = _.defaults(_.pick(params, _.keys(current_clustering)), current_clustering);
            update.owner_secret = system_store.get_server_secret(); //Keep original owner_secret
            update.owner_address = params.owner_address || current_clustering.owner_address;
            update._id = current_clustering._id;
            dbg.log0('Updating local cluster info for owner', update.owner_secret, 'previous cluster info',
                cutil.pretty_topology(current_clustering), 'new cluster info', cutil.pretty_topology(update));

            let changes;
            // if we are adding a new cluster info use insert in the changes
            if (new_clustering) {
                changes = {
                    insert: {
                        clusters: [update]
                    }
                };
            } else {
                changes = {
                    update: {
                        clusters: [update]
                    }
                };
            }

            return system_store.make_changes(changes)
                .then(() => {
                    dbg.log0('local cluster info updates successfully');
                })
                .catch(err => {
                    console.error('failed on local cluster info update with', err.message);
                    throw err;
                });
        });
}

// add a new server to an existing replica set
function _add_new_server_to_replica_set(params) {
    const shardname = params.shardname;
    const ip = params.ip;
    dbg.log0('Adding RS server to', shardname);
    var new_topology = cutil.get_topology();
    var shard_idx = cutil.find_shard_index(shardname);

    //No Such shard
    if (shard_idx === -1) {
        dbg.log0('Cannot add RS member to non-existing shard');
        throw new Error('Cannot add RS member to non-existing shard');
    }

    new_topology.is_clusterized = true;
    // add server's ip to servers list in topology
    new_topology.shards[shard_idx].servers.push({
        address: ip
    });

    if (params.location) {
        new_topology.location = params.location;
    }

    return P.resolve(MongoCtrl.add_replica_set_member(shardname, /*first_server=*/ false, new_topology.shards[shard_idx].servers))
        .then(() => system_store.load())
        .then(() => _attach_server_configuration(new_topology))
        .then(() => P.join(
            os_utils.get_ntp(),
            os_utils.get_time_config(),
            os_utils.get_dns_and_search_domains(),
            (ntp_server, time_config, dns_config) => {
                // insert an entry for this server in clusters collection.
                new_topology._id = system_store.generate_id();
                // get dns and ntp settings configured in the os
                if (ntp_server) {
                    dbg.log0(`_add_new_server_to_replica_set: using existing ntp configuration: ${ntp_server}, ${time_config.timezone}`);
                    new_topology.ntp = {
                        timezone: time_config.timezone,
                        server: ntp_server
                    };
                }
                if (dns_config.dns_servers.length) {
                    dbg.log0(`_add_new_server_to_replica_set: using existing DNS servers configuration: `, dns_config.dns_servers);
                    new_topology.dns_servers = dns_config.dns_servers;
                }

                dbg.log0('inserting topology for new server to clusters collection:', new_topology);
                return system_store.make_changes({
                    insert: {
                        clusters: [new_topology]
                    }
                });
            }
        ))
        .then(() => {
            dbg.log0('Adding new replica set member to the set');
            let new_rs_params = {
                name: shardname,
                IPs: cutil.extract_servers_ip(
                    cutil.get_topology().shards[shard_idx].servers
                ),
                cluster_id: new_topology.cluster_id
            };
            return _publish_to_cluster('news_replicaset_servers', new_rs_params);
        });
}

function _add_new_config_on_server(cfg_array, params) {
    dbg.log0('Adding new local config server', cfg_array);
    return P.resolve(MongoCtrl.add_new_config())
        .then(function() {
            dbg.log0('Adding mongos on config array', cfg_array);
            return MongoCtrl.add_new_mongos(cfg_array);
        })
        .then(function() {
            dbg.log0('Updating config replica set, initiate_replica_set=', params.first_shard ? 'true' : 'false');
            if (params.first_shard) {
                return MongoCtrl.initiate_replica_set(
                    config.MONGO_DEFAULTS.CFG_RSET_NAME, cfg_array, true
                ); //3rd param /*=config set*/
            } else if (!params.remote_server) {
                return MongoCtrl.add_member_to_replica_set(
                    config.MONGO_DEFAULTS.CFG_RSET_NAME, cfg_array, true
                ); //3rd param /*=config set*/
            }
        });
}

function _publish_to_cluster(apiname, req_params) {
    var servers = [];
    _.each(cutil.get_topology().shards, function(shard) {
        _.each(shard.servers, function(single_srv) {
            servers.push(single_srv.address);
        });
    });

    dbg.log0('Sending cluster news:', apiname, 'to:', servers, 'with:', req_params);
    return P.map(servers, function(server) {
        return server_rpc.client.cluster_internal[apiname](req_params, {
            address: server_rpc.get_base_address(server),
            timeout: 60000 //60s
        });
    });
}

function _update_rs_if_needed(IPs, name, is_config) {
    var config_changes = cutil.rs_array_changes(IPs, name, is_config);
    if (config_changes) {
        return MongoCtrl.is_master(is_config)
            .then(is_master => {
                if (is_master.ismaster) {
                    dbg.log0('Current server is master for config RS, Updating to', IPs);
                    return MongoCtrl.add_member_to_replica_set(
                        name,
                        IPs,
                        is_config);
                }
            })
            .then(() => {
                // for all members update the connection string with the new member
                if (!is_config) {
                    return MongoCtrl.update_dotenv(name, IPs);
                }
            });
    }
    return P.resolve();
}

function _get_aws_owner() {
    return P.resolve()
        .then(() => {
            if (process.env.PLATFORM !== 'aws') return;
            const email = `${process.env.AWS_INSTANCE_ID}@noobaa.com`;
            return promise_utils.retry(10, 30000, () => P.fromCallback(callback => request({ method: 'GET', url: `https://store.zapier.com/api/records?secret=${email}` }, callback))
                    .then(res => {
                        dbg.log0(`got activation code for ${email} from zappier. body=`, res.body);
                        const { code } = JSON.parse(res.body);
                        if (!code) {
                            throw new Error('expected returned json to have a code property but it doesnt');
                        }
                        return {
                            activation_code: code,
                            email
                        };
                    })
                    .catch(err => {
                        dbg.error(`got error when trying to get activation code for ${email} from zappier:`, err);
                        throw err;
                    })
                )
                .catch(err => {
                    dbg.error(`FAILED GETTING ACTIVATION CODE FROM ZAPPIER FOR ${email}`, err);
                });
        });
}


function _attach_server_configuration(cluster_server) {
    if (!fs.existsSync('/etc/ntp.conf') || !fs.existsSync('/etc/resolv.conf')) {
        cluster_server.ntp = {
            timezone: os_utils.get_time_config().timezone
        };
        return cluster_server;
    }
    return P.join(fs_utils.find_line_in_file('/etc/ntp.conf', '#NooBaa Configured NTP Server'),
            os_utils.get_time_config(), os_utils.get_dns_and_search_domains())
        .spread(function(ntp_line, time_config, dns_config) {
            cluster_server.ntp = {
                timezone: time_config.timezone
            };
            if (ntp_line && ntp_line.split(' ')[0] === 'server') {
                cluster_server.ntp.server = ntp_line.split(' ')[1];
                dbg.log0('found configured NTP server in ntp.conf:', cluster_server.ntp.server);
            }

            if (dns_config.dns_servers.length > 0) {
                cluster_server.dns_servers = dns_config.dns_servers;
            }

            if (dns_config.search_domains.length) {
                cluster_server.search_domains = dns_config.search_domains;
            }

            return cluster_server;
        });
}

function check_cluster_status() {
    var servers = system_store.data.clusters;
    dbg.log2('check_cluster_status', servers);
    return P.map(_.filter(servers,
            server => server.owner_secret !== system_store.get_server_secret()),
        server => server_rpc.client.cluster_server.ping({}, {
            address: server_rpc.get_base_address(server.owner_address)
        })
        .timeout(30000)
        .then(res => {
            if (res === "PONG") {
                return {
                    secret: server.owner_secret,
                    status: "OPERATIONAL"
                };
            }
            return {
                secret: server.owner_secret,
                status: "FAULTY"
            };
        })
        .catch(err => {
            dbg.warn(`error while pinging server ${server.owner_secret}: `, err.stack || err);
            return {
                secret: server.owner_secret,
                status: "UNREACHABLE"
            };
        }));
}

function reset_upgrade_package_status(req) {
    const updates = system_store.data.clusters.map(cluster => ({
        _id: cluster._id,
        $set: {
            'upgrade.status': 'COMPLETED'
        }
    }));
    Dispatcher.instance().activity({
        event: 'conf.upload_package',
        level: 'info',
        system: req.system._id,
        actor: req.account && req.account._id,
    });

    return system_store.make_changes({
            update: {
                clusters: updates
            }
        })
        .then(() => Dispatcher.instance().publish_fe_notifications({ secret: system_store.get_server_secret() }, 'change_upgrade_status'));
}

function ping() {
    return "PONG";
}

function _get_upgrade_path() {
    let server = system_store.get_local_cluster_info();
    // if (server.upgrade.status !== 'CAN_UPGRADE') {
    //     throw new Error('Not in upgrade state:', server.upgrade.error ? server.upgrade.error : '');
    // }
    if (server.upgrade.path === '') {
        throw new Error('No package path supplied');
    }
    return server.upgrade.path;
}

// EXPORTS
exports._init = _init;
exports.new_cluster_info = new_cluster_info;
exports.init_cluster = init_cluster;
exports.redirect_to_cluster_master = redirect_to_cluster_master;
exports.add_member_to_cluster = add_member_to_cluster;
exports.join_to_cluster = join_to_cluster;
exports.news_config_servers = news_config_servers;
exports.news_updated_topology = news_updated_topology;
exports.news_replicaset_servers = news_replicaset_servers;
exports.update_time_config = update_time_config;
exports.apply_updated_time_config = apply_updated_time_config;
exports.update_dns_servers = update_dns_servers;
exports.apply_updated_dns_servers = apply_updated_dns_servers;
exports.set_debug_level = set_debug_level;
exports.apply_set_debug_level = apply_set_debug_level;
exports.diagnose_system = diagnose_system;
exports.collect_server_diagnostics = collect_server_diagnostics;
exports.read_server_time = read_server_time;
exports.apply_read_server_time = apply_read_server_time;
exports.read_server_config = read_server_config;
exports.member_pre_upgrade = member_pre_upgrade;
exports.do_upgrade = do_upgrade;
exports.upgrade_cluster = upgrade_cluster;
exports.check_cluster_status = check_cluster_status;
exports.ping = ping;
exports.verify_candidate_join_conditions = verify_candidate_join_conditions;
exports.verify_join_conditions = verify_join_conditions;
exports.verify_new_ip = verify_new_ip;
exports.update_server_conf = update_server_conf;
exports.set_hostname_internal = set_hostname_internal;
exports.get_version = get_version;
exports.get_secret = get_secret;
exports.get_upgrade_status = get_upgrade_status;
exports.update_member_of_cluster = update_member_of_cluster;
exports.cluster_pre_upgrade = cluster_pre_upgrade;
exports.reset_upgrade_package_status = reset_upgrade_package_status;
