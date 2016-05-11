/**
 * Cluster Server
 */
'use strict';

const _ = require('lodash');
const fs = require('fs');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const system_store = require('../system_services/system_store').get_instance();
const server_rpc = require('../server_rpc');
const mongo_ctrl = require('../utils/mongo_ctrl');

var SECRET;
var TOPOLOGY;

function _init() {
    return P.nfcall(fs.readFile, config.CLUSTERING_PATHS.SECRET_FILE)
        .then(function(data) {
            SECRET = data.toString();
            SECRET = SECRET.substring(0, SECRET.length - 1);
            console.warn('NBNB:: SECRET is', SECRET);
        })
        .fail(function(err) {
            if (err.code === 'ENOENT') {
                dbg.log0('No', config.CLUSTERING_PATHS.SECRET_FILE, 'exists');
            }
            return;
        })
        .then(function() {
            return P.nfcall(fs.stat, config.CLUSTERING_PATHS.TOPOLOGY_FILE);
        })
        .then(function(exists) {
            return P.nfcall(fs.readFile, config.CLUSTERING_PATHS.TOPOLOGY_FILE);
        })
        .then(function(top) {
            TOPOLOGY = JSON.parse(top);
        })
        .fail(function(err) {
            if (err.code !== 'ENOENT') {
                console.error('Topology file corrupted');
            } else if (TOPOLOGY) {
                //Create a default structure in the memory
                TOPOLOGY.cluster_id = '';
                TOPOLOGY.shards = [];
                TOPOLOGY.config_servers = [];
            }
        });
}

//
//API
//
function get_cluster_id(req) {
    var cluster = system_store.data.clusters[0];
    return {
        cluster_id: cluster && cluster.cluster_id || ''
    };
}

function add_member_to_cluster(req) {
    dbg.log0('Recieved add member to cluster req', req.rpc_params);
    var id = get_cluster_id(req).cluster_id.toString();

    return server_rpc.client.cluster_server.join_to_cluster({
            ip: req.rpc_params.ip,
            topology: TOPOLOGY,
            cluster_id: id,
            secret: req.rpc_params.secret,
            role: req.rpc_params.role,
            shard: req.rpc_params.shard,
        }, {
            address: 'ws://' + req.rpc_params.ip + ':8080',
            timeout: 30000 //30s
        })
        .fail(function(err) {
            console.warn('Failed adding members to cluster', req.rpc_params, 'with', err);
            throw new Error('Failed adding members to cluster');
        })
        .then(function() {
            console.log('Added members to cluster');
            return;
        });
}

function join_to_cluster(req) {
    console.warn('NBNB:: got join_to_cluster', req.rpc_params);
    if (req.rpc_params.secret !== SECRET) {
        throw new Error('Secrets do not match!');
    }

    if (TOPOLOGY) {
        if (TOPOLOGY.cluster_id !== req.rpc_params.cluster_id) {
            console.error('Server already joined to a different cluster');
            throw new Error('Server joined to a different cluster');
        }
        //TODO:: NBNB else {}
        //Server is already part of this cluster, all is well

        //TODO:: need to think regarding role switch: ReplicaSet chain vs. Shard (or switching between
        //different ReplicaSet Chains)
        //Easy path -> detach and re-attach as new role, though creates more hassle for the admin and
        //overall lengthier process
        return;
    }

    return P.nfcall(function() {
            if (req.rpc_params.role === 'SHARD') {
                return _add_new_shard_member(req.rpc_params.shard, req.rpc_params.ip);
            } else if (req.rpc_params.role === 'REPLICA') {
                return _add_new_replicaset_member(req.rpc_params.shard, req.rpc_params.ip);
            } else {
                dbg.error('Unknown role', req.rpc_params.role, 'recieved, ignoring');
                throw new Error('Unknown server role ' + req.rpc_params.role);
            }
        })
        .then(function() {
            return _publish_to_cluster('news_updated_topology', TOPOLOGY);
        });
}

function news_config_servers(req) {
    if (!TOPOLOGY ||
        TOPOLOGY.cluster_id !== req.rpc_params.cluster_id) {
        dbg.error('No cluster or cluster mismatch', TOPOLOGY);
        throw new Error('No cluster or cluster mismatch');
    }

    if (req.rpc_params.IPs.length < 3) {
        dbg.log('Current config replicaset < 3, not starting mongos services');
        return;
    }

    //We have a valid config replica set, start the mongos service
    TOPOLOGY.config_servers = req.rpc_params.IPs;
    return mongo_ctrl.add_new_mongos(TOPOLOGY.config_servers);

    //TODO:: Update connection string for our mongo connections
    //probably have something stored in mongo_ctrl and return it, need to update current connections
}

function news_updated_topology(req) {
    if (!TOPOLOGY ||
        TOPOLOGY.cluster_id !== req.rpc_params.cluster_id) {
        dbg.error('No cluster or cluster mismatch', TOPOLOGY);
        throw new Error('No cluster or cluster mismatch');
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
    TOPOLOGY.shards.push({
        name: shardname,
        servers: [ip],
    });
    return mongo_ctrl.add_new_shard_server(shardname)
        .then(function() {
            //TODO:: must find a better solution than enforcing 3 shards when all user
            //wanted was actually two, maybe setup a 3rd config on one of the replica sets servers
            //if exists

            if (TOPOLOGY.config_servers.length === 3) { //Currently stay with a repset of 3 for config
                return mongo_ctrl.add_new_mongos(TOPOLOGY.config_servers);
            } else { // < 3 since we don't add once we reach 3
                TOPOLOGY.config_servers.push(ip);
                return mongo_ctrl.add_new_config()
                    .then(function() {
                        return _publish_to_cluster('news_config_servers', TOPOLOGY.config_servers);
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

    return mongo_ctrl.add_replica_set_member(shardname)
        .then(function() {
            TOPOLOGY.shards[shard_idx].servers.push(ip);
            var rs_length = TOPOLOGY.shards[shard_idx].servers.length;
            if (rs_length === 3) {
                //Initiate replica set and add all members
                return mongo_ctrl.initiate_replica_set(shardname, TOPOLOGY.shards[shard_idx].servers);
            } else if (rs_length > 3) {
                //joining an already existing and functioning replica set, add new member
                return mongo_ctrl.add_member_to_replica_set(shardname, TOPOLOGY.shards[shard_idx].servers);
            } else {
                //2 servers, nothing to be done yet. RS will be activated on the 3rd join
                return;
            }
        });
}

function _publish_to_cluster(apiname, req_params) {
    var servers = [];
    _.each(TOPOLOGY.shards, function(shard) {
        _.each(shard.servers, function(single_srv) {
            servers.concat(single_srv);
        });
    });
    return P.each(servers, function(server) {
        return server_rpc.client.cluster_server[apiname](req_params, {
            address: 'ws://' + server.ip + ':8080',
            timeout: 30000 //30s
        });
    });
}


// EXPORTS
exports._init = _init;
exports.get_cluster_id = get_cluster_id;
exports.add_member_to_cluster = add_member_to_cluster;
exports.join_to_cluster = join_to_cluster;
exports.news_config_servers = news_config_servers;
exports.news_updated_topology = news_updated_topology;
exports.heartbeat = heartbeat;
