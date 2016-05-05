/* jshint node:true */
'use strict';

/*
 * Cluster Server
 */

var cluster_server = {
    _init: _init,

    add_member_to_cluster: add_member_to_cluster,
    join_to_cluster: join_to_cluster,
    news_config_servers: news_config_servers,
    news_updated_topology: news_updated_topology,
    heartbeat: heartbeat,
};

module.exports = cluster_server;

var _ = require('lodash');
var fs = require('fs');
var uuid = require('node-uuid');
var server_rpc = require('./server_rpc');
var MongoCtrl = require('./utils/mongo_ctrl');
var P = require('../util/promise');
var os_utils = require('../util/os_util');
var dbg = require('../util/debug_module')(__filename);
var config = require('../../config.js');

var SECRET;
var TOPOLOGY = {};

function _init() {
    // Read Secret
    return P.nfcall(fs.readFile, config.CLUSTERING_PATHS.SECRET_FILE)
        .then(function(data) {
            SECRET = data.toString();
            SECRET = SECRET.substring(0, SECRET.length - 1);
        })
        .fail(function(err) {
            if (err.code === 'ENOENT') {
                dbg.log0('No', config.CLUSTERING_PATHS.SECRET_FILE, 'exists');
            }
            return;
        })
        //verify Topology file exists, performed to get the appropriate ENOENT error
        .then(function() {
            return P.nfcall(fs.stat, config.CLUSTERING_PATHS.TOPOLOGY_FILE);
        })
        //read Topology
        .then(function(exists) {
            return P.nfcall(fs.readFile, config.CLUSTERING_PATHS.TOPOLOGY_FILE);
        })
        .then(function(top) {
            TOPOLOGY = JSON.parse(top);
        })
        .fail(function(err) {
            if (err.code !== 'ENOENT') {
                console.error('Topology file corrupted');
                return;
            } else { //Create a default structure in the memory and in topology file
                dbg.log0('No', config.CLUSTERING_PATHS.TOPOLOGY_FILE, 'exists, creating a default one');
                TOPOLOGY.cluster_id = uuid().substring(0, 8);

                TOPOLOGY.shards = [{
                    name: 'shard1',
                    servers: [os_utils.get_local_ipv4_ips()[0]], //TODO:: when moving to multiple interface, handle it
                }];
                TOPOLOGY.config_servers = [];
                return P.nfcall(fs.writeFile, config.CLUSTERING_PATHS.TOPOLOGY_FILE, JSON.stringify(TOPOLOGY));
            }
        })
        .then(function() {
            //init mongo control
            return MongoCtrl.init();
        });
}

//
//API
//
function add_member_to_cluster(req) {
    dbg.log0('Recieved add member to cluster req', req.rpc_params, 'current topology', TOPOLOGY);
    var id = TOPOLOGY.cluster_id;


    return P.fcall(function() {
            if (req.rpc_params.role === 'SHARD') {
                let myip = os_utils.get_local_ipv4_ips()[0];
                //If adding shard, and current server does not have config on it, add
                if (_.findIndex(TOPOLOGY.config_servers, function(srv) {
                        return srv === myip;
                    }) === -1) {
                    dbg.log0('Current server is the first on cluster and still has single mongo running, updating');
                    return _add_new_shard_member('shard1', myip);
                }
            } else {
                return P.resolve();
            }

        })
        .then(function() {
            dbg.log0('Sending join_to_cluster to', req.rpc_params.ip);
            return server_rpc.client.cluster_server.join_to_cluster({
                ip: req.rpc_params.ip,
                topology: TOPOLOGY,
                cluster_id: id,
                secret: req.rpc_params.secret,
                role: req.rpc_params.role,
                shard: req.rpc_params.shard,
            }, {
                address: 'ws://' + req.rpc_params.ip + ':8080',
                timeout: 60000 //60s
            });
        })
        .fail(function(err) {
            console.warn('Failed adding members to cluster', req.rpc_params, 'with', err);
            throw new Error('Failed adding members to cluster');
        })
        .then(function() {
            dbg.log0('Added member', req.rpc_params.ip, 'to cluster. New topology', TOPOLOGY);
            return;
        });
}

function join_to_cluster(req) {
    dbg.log0('Got join_to_cluster request', req.rpc_params);
    if (req.rpc_params.secret !== SECRET) {
        console.error('Secrets do not match!');
        throw new Error('Secrets do not match!');
    }

    if (TOPOLOGY.shards.length !== 1 ||
        TOPOLOGY.shards[0].servers.length !== 1) {
        console.error('Server already joined to a cluster');
        throw new Error('Server joined to a cluster');
    }

    //TODO:: need to think regarding role switch: ReplicaSet chain vs. Shard (or switching between
    //different ReplicaSet Chains)
    //Easy path -> detach and re-attach as new role, though creates more hassle for the admin and
    //overall lengthier process

    dbg.log0('Replacing current topology', TOPOLOGY, 'with', req.rpc_params.topology);
    TOPOLOGY = req.rpc_params.topology;
    return P.fcall(function() {
            if (req.rpc_params.role === 'SHARD') {
                TOPOLOGY.shards.push({
                    name: req.rpc_params.shard,
                    servers: [req.rpc_params.ip]
                });
                return _add_new_shard_member(req.rpc_params.shard, req.rpc_params.ip);
            } else if (req.rpc_params.role === 'REPLICA') {
                return _add_new_replicaset_member(req.rpc_params.shard, req.rpc_params.ip);
            } else {
                dbg.error('Unknown role', req.rpc_params.role, 'recieved, ignoring');
                throw new Error('Unknown server role ' + req.rpc_params.role);
            }
        })
        .then(function() {
            dbg.log0('Added member, publishing updated topology');
            return _publish_to_cluster('news_updated_topology', TOPOLOGY);
        });
}

function news_config_servers(req) {
    dbg.log0('Recieved news_config_servers', req.rpc_params);
    if (TOPOLOGY.cluster_id !== req.rpc_params.cluster_id) {
        dbg.error('ClusterID mismatch: has', TOPOLOGY.cluster_id, ' recieved:', req.rpc_params.cluster_id);
        throw new Error('ClusterID mismatch');
    }

    if (req.rpc_params.IPs.length < 3) {
        dbg.log('Current config replicaset < 3, not starting mongos services');
        return;
    }

    //We have a valid config replica set, start the mongos service
    TOPOLOGY.config_servers = req.rpc_params.IPs;
    return MongoCtrl.add_new_mongos(TOPOLOGY.config_servers);

    //TODO:: NBNB Update connection string for our mongo connections
    //probably have something stored in MongoCtrl and return it, need to update current connections
}

function news_updated_topology(req) {
    dbg.log0('Recieved news_updated_topology', req.rpc_params);
    if (TOPOLOGY.cluster_id !== req.rpc_params.cluster_id) {
        dbg.error('ClusterID mismatch: has', TOPOLOGY.cluster_id, ' recieved:', req.rpc_params.cluster_id);
        throw new Error('ClusterID mismatch');
    }

    TOPOLOGY = req.rpc_params.topology;
    return P.nfcall(fs.writeFile, config.CLUSTERING_PATHS.TOPOLOGY_FILE, JSON.stringify(TOPOLOGY));
}

function heartbeat(req) {
    //TODO:: ...
    dbg.log('Clustering HB currently not implemented');
}


//
//Internals
//
function _add_new_shard_member(shardname, ip) {
    dbg.log0('Adding shard, new topology', TOPOLOGY);

    return P.when(MongoCtrl.add_new_shard_server(shardname))
        .then(function() {
            //TODO:: must find a better solution than enforcing 3 shards when all user
            //wanted was actually two, maybe setup a 3rd config on one of the replica sets servers
            //if exists
            dbg.log('Checking current config servers set, currently contains', TOPOLOGY.config_servers.length, 'servers');
            if (TOPOLOGY.config_servers.length === 3) { //Currently stay with a repset of 3 for config
                return MongoCtrl.add_new_mongos(TOPOLOGY.config_servers);
            } else { // < 3 since we don't add once we reach 3
                TOPOLOGY.config_servers.push(ip);
                //TODO:: NBNB need to call _add_new_config
                //we don't simply add a new config, we need to initiate and create the replicas set for config
                return P.when(MongoCtrl.add_new_config())
                    .then(function() {
                        dbg.log0('Added', ip, 'as a config server publish to cluster');
                        return _publish_to_cluster('news_config_servers', {
                            IPs: TOPOLOGY.config_servers,
                            cluster_id: TOPOLOGY.cluster_id
                        });
                    });
            }
        });
}

function _add_new_replicaset_member(shardname, ip) {
    var shard_idx = _.findIndex(TOPOLOGY.shards, function(s) {
        return shardname === s.name;
    });

    //No Such shard
    if (shard_idx === -1) {
        throw new Error('Cannot add RS member to non-existing shard');
    }

    TOPOLOGY.shards[shard_idx].servers.push(ip);
    dbg.log0('Adding rs member, new topology', TOPOLOGY);

    return MongoCtrl.add_replica_set_member(shardname)
        .then(function() {
            TOPOLOGY.shards[shard_idx].servers.push(ip);
            var rs_length = TOPOLOGY.shards[shard_idx].servers.length;
            if (rs_length === 3) {
                //Initiate replica set and add all members
                return MongoCtrl.initiate_replica_set(shardname, TOPOLOGY.shards[shard_idx].servers);
            } else if (rs_length > 3) {
                //joining an already existing and functioning replica set, add new member
                return MongoCtrl.add_member_to_replica_set(shardname, TOPOLOGY.shards[shard_idx].servers);
            } else {
                //2 servers, nothing to be done yet. RS will be activated on the 3rd join
                return;
            }
        });
}

function _add_new_config() {
    //To be called from _add_new_shard_member
    //  return MongoCtrl.add_new_config()
    //similar to wahat we do in rset, if length of config is 3, >3 etc.
}

function _publish_to_cluster(apiname, req_params) {
    dbg.log0('Sending cluster news', apiname);
    var servers = [];
    _.each(TOPOLOGY.shards, function(shard) {
        _.each(shard.servers, function(single_srv) {
            servers.push(single_srv);
        });
    });
    console.warn('NBNB:: sending', apiname, 'to the following servers', servers, 'with', req_params);
    return P.each(servers, function(server) {
        return server_rpc.client.cluster_server[apiname](req_params, {
            address: 'ws://' + server + ':8080',
            timeout: 60000 //60s
        });
    });
}
