/* jshint node:true */
'use strict';

/*
 * Cluster Server
 */

var cluster_server = {
    _init: _init,

    get_cluster_id: get_cluster_id,
    add_member_to_cluster: add_member_to_cluster,
    join_to_cluster: join_to_cluster,
    publish_config_servers: publish_config_servers,
    heartbeat: heartbeat,
};

module.exports = cluster_server;

var _ = require('lodash');
var fs = require('fs');
var system_store = require('./stores/system_store');
var server_rpc = require('./server_rpc');
var mongo_ctrl = require('./utils/mongo_ctrl');
var P = require('../util/promise');
var dbg = require('../util/debug_module')(__filename);
var config = require('../../config.js');

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
            } else { //Create a default structure in the memory
                TOPOLOGY.cluster_id = '';
                TOPOLOGY.shards = [];
                TOPOLOGY.config_servers = [];
            }
        });
}

/**
 *
 * GET_CLUSTER_ID
 *
 */
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

    if (req.rpc_params.role !== 'SHARD' ||
        req.rpc_params.role !== 'REPLICA') {
        dbg.error('Unknown role', req.rpc_params.role, 'recieved, ignoring');
        throw new Error('Unknown server role ' + req.rpc_params.role);
    }

    //So far so good, write the topology file
    TOPOLOGY = req.rpc_params.topology;

    return P.nfcall(fs.writeFile, config.CLUSTERING_PATHS.TOPOLOGY_FILE, JSON.stringify(TOPOLOGY))
        .then(function() {
            if (req.rpc_params.role === 'SHARD') {
                return _add_new_shard_member(req.rpc_params.shard, req.rpc_params.ip);
            } else if (req.rpc_params.role === 'REPLICA') {
                return _add_new_replicaset_member(req.rpc_params.shard);
            }
        });
}

function _add_new_shard_member(shardname, ip) {
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
                        return _update_cluster_config_servers();
                    });
            }
        });
}

function publish_config_servers(req) {
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
}

function heartbeat(req) {
    //TODO:: ...
    dbg.log('Clustering HB currently not implemented');
}

function _add_new_replicaset_member(shardname) {
    //add server as RS
    return mongo_ctrl.add_replica_set_member();
}

function _update_cluster_config_servers() {
    var servers = [];
    _.each(TOPOLOGY.shards, function(shard_servers) {
        servers.concat(shard_servers);
    });
    return P.each(servers, function(server) {
        return server_rpc.client.cluster_server.publish_config_servers({
            IPs: TOPOLOGY.config_servers,
        }, {
            address: 'ws://' + server.ip + ':8080',
            timeout: 30000 //30s
        });
    });
}
