/**
 * Cluster Server
 */
'use strict';

const _ = require('lodash');
const uuid = require('node-uuid');
const system_store = require('./system_store').get_instance();
const server_rpc = require('../server_rpc');
const MongoCtrl = require('../utils/mongo_ctrl');
const cutil = require('../utils/clustering_utils');
const P = require('../../util/promise');
const os_utils = require('../../util/os_utils');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const pkg = require('../../../package.json');

function _init() {
    return P.resolve(MongoCtrl.init());
}

//
//API
//

//Return new cluster info, if doesn't exists in db
function new_cluster_info() {
    if (system_store.get_local_cluster_info()) {
        return;
    }

    var address = os_utils.get_local_ipv4_ips()[0];
    var cluster = {
        is_clusterized: false,
        owner_secret: system_store.get_server_secret(),
        cluster_id: uuid().substring(0, 8),
        owner_address: address,
        shards: [{
            shardname: 'shard1',
            servers: [{
                address: address //TODO:: on multiple nics support, fix this
            }],
        }],
        config_servers: [],
    };

    return cluster;
}

//Initiate process of adding a server to the cluster
function add_member_to_cluster(req) {
    if (!os_utils.is_supervised_env()) {
        console.warn('Environment is not a supervised one, currently not allowing clustering operations');
        throw new Error('Environment is not a supervised one, currently not allowing clustering operations');
    }

    dbg.log0('Recieved add member to cluster req', req.rpc_params, 'current topology',
        cutil.pretty_topology(cutil.get_topology()));
    let topology = cutil.get_topology();
    var id = topology.cluster_id;
    let is_clusterized = topology.is_clusterized;

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
        .then(function() {
            // after a cluster was initiated, join the new member
            dbg.log0('Sending join_to_cluster to', req.rpc_params.ip, cutil.get_topology());
            //Send a join_to_cluster command to the new joining server
            return server_rpc.client.cluster_server.join_to_cluster({
                ip: req.rpc_params.ip,
                topology: cutil.get_topology(),
                cluster_id: id,
                secret: req.rpc_params.secret,
                role: req.rpc_params.role,
                shard: req.rpc_params.shard,
            }, {
                address: 'ws://' + req.rpc_params.ip + ':8080',
                timeout: 60000 //60s
            });
        })
        .catch(function(err) {
            console.error('Failed adding members to cluster', req.rpc_params, 'with', err);
            throw new Error('Failed adding members to cluster');
        })
        .then(function() {
            dbg.log0('Added member', req.rpc_params.ip, 'to cluster. New topology',
                cutil.pretty_topology(cutil.get_topology()));
            return;
        });
}


function join_to_cluster(req) {
    dbg.log0('Got join_to_cluster request with topology', cutil.pretty_topology(req.rpc_params.topology),
        'existing topology is:', cutil.pretty_topology(cutil.get_topology()));


    _verify_join_preconditons(req);

    //TODO:: need to think regarding role switch: ReplicaSet chain vs. Shard (or switching between
    //different ReplicaSet Chains)
    //Easy path -> don't support it, make admin detach and re-attach as new role,
    //though this creates more hassle for the admin and overall lengthier process

    // first thing we update the new topology as the local topoology.
    // later it will be updated to hold this server's info in the cluster's DB
    return P.resolve(cutil.update_cluster_info(req.rpc_params.topology))
        .then(() => {
            dbg.log0('server new role is', req.rpc_params.role);
            if (req.rpc_params.role === 'SHARD') {
                //Server is joining as a new shard, update the shard topology

                return P.resolve(cutil.update_cluster_info(
                        cutil.get_topology().shards.push({
                            shardname: req.rpc_params.shard,
                            servers: [{
                                address: req.rpc_params.ip
                            }]
                        })
                    ))
                    .then(() => {
                        //Add the new shard server
                        return _add_new_shard_on_server(req.rpc_params.shard, req.rpc_params.ip, {
                            first_shard: false,
                            remote_server: true
                        });
                    });
            } else if (req.rpc_params.role === 'REPLICA') {
                //Server is joining as a replica set member to an existing shard, update shard chain topology
                //And add an appropriate server
                return _add_new_server_to_replica_set(req.rpc_params.shard, req.rpc_params.ip);
            } else {
                dbg.error('Unknown role', req.rpc_params.role, 'recieved, ignoring');
                throw new Error('Unknown server role ' + req.rpc_params.role);
            }
        })
        .then(function() {
            dbg.log0('Added member, publishing updated topology', cutil.pretty_topology(cutil.get_topology()));
            //Mongo servers are up, update entire cluster with the new topology
            return _publish_to_cluster('news_updated_topology', cutil.get_topology());
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
        .then(() => {
            //Update our view of the topology
            return P.resolve(cutil.update_cluster_info({
                    config_servers: req.rpc_params.IPs
                }))
                .then(() => {
                    //We have a valid config replica set, start the mongos service
                    return MongoCtrl.add_new_mongos(cutil.extract_servers_ip(
                        cutil.get_topology().config_servers
                    ));

                    //TODO:: NBNB Update connection string for our mongo connections, currently only seems needed for
                    //Replica sets =>
                    //Need to close current connections and re-open (bg_worker, all webservers)
                    //probably best to use publish_to_cluster
                });
        });
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
    //Verify we recieved news on the cluster we are joined to
    cutil.verify_cluster_id(req.rpc_params.cluster_id);

    dbg.log0('updating topolgy to the new published topology:', req.rpc_params);
    //Update our view of the topology
    return P.resolve(cutil.update_cluster_info(req.rpc_params));
}

function do_heartbeat() {
    let current_clustering = system_store.get_local_cluster_info();
    if (current_clustering && current_clustering.is_clusterized) {
        let heartbeat = {
            version: pkg.version,
            time: Date.now(),
            health: {
                os_info: os_utils.os_info(),
            }
        };
        return MongoCtrl.get_mongo_rs_status()
            .then(mongo_status => {
                if (mongo_status) {
                    heartbeat.health.mongo_rs_status = mongo_status;
                }
                let update = {
                    _id: current_clustering._id,
                    heartbeat: heartbeat
                };
                dbg.log0('writing cluster server heartbeat to DB. heartbeat:', heartbeat);
                return system_store.make_changes({
                    update: {
                        clusters: [update]
                    }
                });
            })
            .return();
    } else {
        dbg.log0('no local cluster info or server is not part of a cluster. HB is not written');
    }
}


//
//Internals Cluster Control
//

function _verify_join_preconditons(req) {
    //Verify secrets match
    if (req.rpc_params.secret !== system_store.get_server_secret()) {
        console.error('Secrets do not match!');
        throw new Error('Secrets do not match!');
    }

    //Verify we are not already joined to a cluster
    //TODO:: think how do we want to handle it, if at all
    if (cutil.get_topology().shards.length !== 1 ||
        cutil.get_topology().shards[0].servers.length !== 1) {
        console.error('Server already joined to a cluster');
        throw new Error('Server joined to a cluster');
    }

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
            } else {
                return;
            }
        })
        .then(function() {
            if (config_updates.config_servers) {
                dbg.log0('Added', ip, 'as a config server publish to cluster');
                return _publish_to_cluster('news_config_servers', {
                    IPs: config_updates.config_servers,
                    cluster_id: current_topology.cluster_id
                });
            } else {
                return;
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

    // first update topology to indicate clusterization
    return P.resolve(() => cutil.update_cluster_info(new_topology))
        .then(() => MongoCtrl.add_replica_set_member(shardname, /*first_server=*/ true, new_topology.shards[shard_idx].servers))
        .then(() => {
            dbg.log0('Replica set created, calling initiate');
            return MongoCtrl.initiate_replica_set(shardname, cutil.extract_servers_ip(
                cutil.get_topology().shards[shard_idx].servers
            ));
        });
}

// add a new server to an existing replica set
function _add_new_server_to_replica_set(shardname, ip) {
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


    return P.resolve(MongoCtrl.add_replica_set_member(shardname, /*first_server=*/ false, new_topology.shards[shard_idx].servers))
        .then(() => system_store.load())
        .then(() => {
            // insert an entry for this server in clusters collection.
            new_topology._id = system_store.generate_id();
            dbg.log0('inserting topology for new server to clusters collection:', new_topology);
            return system_store.make_changes({
                insert: {
                    clusters: [new_topology]
                }
            });
        })
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
            } else {
                return;
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
    return P.each(servers, function(server) {
        return server_rpc.client.cluster_server[apiname](req_params, {
            address: 'ws://' + server + ':8080',
            timeout: 60000 //60s
        });
    });
}

function _update_rs_if_needed(IPs, name, is_config) {
    var config_changes = cutil.rs_array_changes(IPs, name, is_config);
    if (config_changes) {
        return MongoCtrl.is_master(is_config)
            .then((is_master) => {
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
    return;
}

// EXPORTS
exports._init = _init;
exports.new_cluster_info = new_cluster_info;
exports.add_member_to_cluster = add_member_to_cluster;
exports.join_to_cluster = join_to_cluster;
exports.news_config_servers = news_config_servers;
exports.news_updated_topology = news_updated_topology;
exports.news_replicaset_servers = news_replicaset_servers;
exports.do_heartbeat = do_heartbeat;
