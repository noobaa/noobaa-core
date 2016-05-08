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
var server_rpc = require('./server_rpc');
var system_store = require('./stores/system_store');
var MongoCtrl = require('./utils/mongo_ctrl');
var P = require('../util/promise');
var os_utils = require('../util/os_util');
var dbg = require('../util/debug_module')(__filename);

function _init() {
    var self = this;
    return os_utils.read_server_secret()
        .then((sec) => {
            self._secret = sec;
            return P.when(MongoCtrl.init());
        });
}

//
//API
//
function add_member_to_cluster(req) {
    dbg.log0('Recieved add member to cluster req', req.rpc_params, 'current topology', _get_topology());
    var id = _get_topology().cluster_id;

    return P.fcall(function() {
            if (req.rpc_params.role === 'SHARD') {
                let myip = os_utils.get_local_ipv4_ips()[0];
                //If adding shard, and current server does not have config on it, add
                if (_.findIndex(_get_topology().config_servers, function(srv) {
                        return srv.address === myip;
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
                topology: _get_topology(),
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
            dbg.log0('Added member', req.rpc_params.ip, 'to cluster. New topology', _get_topology());
            return;
        });
}

function join_to_cluster(req) {
    dbg.log0('Got join_to_cluster request', req.rpc_params);
    if (req.rpc_params.secret !== _get_secret()) {
        console.error('Secrets do not match!');
        throw new Error('Secrets do not match!');
    }

    if (_get_topology().shards.length !== 1 ||
        _get_topology().shards[0].servers.length !== 1) {
        console.error('Server already joined to a cluster');
        throw new Error('Server joined to a cluster');
    }

    //TODO:: need to think regarding role switch: ReplicaSet chain vs. Shard (or switching between
    //different ReplicaSet Chains)
    //Easy path -> detach and re-attach as new role, though creates more hassle for the admin and
    //overall lengthier process

    dbg.log0('Replacing current topology', _get_topology(), 'with', req.rpc_params.topology);
    _update_cluster_info(req.rpc_params.topology);
    return P.fcall(function() {
            if (req.rpc_params.role === 'SHARD') {
                _update_cluster_info(
                    _get_topology.shards.push({
                        name: req.rpc_params.shard,
                        servers: [{
                            address: req.rpc_params.ip
                        }]
                    })
                );
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
            return _publish_to_cluster('news_updated_topology', _get_topology());
        });
}

function news_config_servers(req) {
    dbg.log0('Recieved news_config_servers', req.rpc_params);
    if (_get_topology().cluster_id !== req.rpc_params.cluster_id) {
        dbg.error('ClusterID mismatch: has', _get_topology().cluster_id, ' recieved:', req.rpc_params.cluster_id);
        throw new Error('ClusterID mismatch');
    }

    _update_cluster_info({
        config_servers: req.rpc_params.IPs
    });

    if (req.rpc_params.IPs.length < 3) {
        dbg.log('Current config replicaset < 3, not starting mongos services');
        return;
    }

    //We have a valid config replica set, start the mongos service
    return MongoCtrl.add_new_mongos(_extract_servers_ip(
        _get_topology().config_servers
    ));

    //TODO:: NBNB Update connection string for our mongo connections
    //probably have something stored in MongoCtrl and return it, need to update current connections
}

function news_updated_topology(req) {
    dbg.log0('Recieved news_updated_topology', req.rpc_params);
    if (_get_topology().cluster_id !== req.rpc_params.cluster_id) {
        dbg.error('ClusterID mismatch: has', _get_topology().cluster_id, ' recieved:', req.rpc_params.cluster_id);
        throw new Error('ClusterID mismatch');
    }

    _update_cluster_info(req.rpc_params.topology);
    return;
}

function heartbeat(req) {
    //TODO:: ...
    dbg.log('Clustering HB currently not implemented');
}


//
//Internals Cluster Control
//
function _add_new_shard_member(shardname, ip) {
    dbg.log0('Adding shard, new topology', _get_topology());

    return P.when(MongoCtrl.add_new_shard_server(shardname))
        .then(function() {
            //TODO:: must find a better solution than enforcing 3 shards when all user
            //wanted was actually two, maybe setup a 3rd config on one of the replica sets servers
            //if exists
            dbg.log('Checking current config servers set, currently contains', _get_topology().config_servers.length, 'servers');
            if (_get_topology().config_servers.length === 3) { //Currently stay with a repset of 3 for config
                return MongoCtrl.add_new_mongos(_extract_servers_ip(
                    _get_topology().config_servers
                ));
            } else { // < 3 since we don't add once we reach 3
                var updated_cfg = _get_topology().config_servers;
                updated_cfg.push({
                    address: ip
                });
                _update_cluster_info({
                    config_servers: updated_cfg
                });
                //TODO:: NBNB need to call _add_new_config
                //we don't simply add a new config, we need to initiate and create the replicas set for config
                return P.when(MongoCtrl.add_new_config())
                    .then(function() {
                        dbg.log0('Added', ip, 'as a config server publish to cluster');
                        return _publish_to_cluster('news_config_servers', {
                            IPs: _get_topology().config_servers,
                            cluster_id: _get_topology().cluster_id
                        });
                    });
            }
        });
}

function _add_new_replicaset_member(shardname, ip) {
    var shard_idx = _.findIndex(_get_topology().shards, function(s) {
        return shardname === s.name;
    });

    //No Such shard
    if (shard_idx === -1) {
        throw new Error('Cannot add RS member to non-existing shard');
    }

    _update_cluster_info(
        _get_topology.shards[shard_idx].servers.push({
            address: ip
        })
    );

    return MongoCtrl.add_replica_set_member(shardname)
        .then(function() {

            var rs_length = _get_topology.shards[shard_idx].servers.length;
            if (rs_length === 3) {
                //Initiate replica set and add all members
                return MongoCtrl.initiate_replica_set(shardname, _extract_servers_ip(
                    _get_topology.shards[shard_idx].servers
                ));
            } else if (rs_length > 3) {
                //joining an already existing and functioning replica set, add new member
                return MongoCtrl.add_member_to_replica_set(shardname, _extract_servers_ip(
                    _get_topology.shards[shard_idx].servers
                ));
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
    _.each(_get_topology().shards, function(shard) {
        _.each(shard.servers, function(single_srv) {
            servers.push(single_srv.address);
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

//
//Internals Utiliy
//

function _get_secret() {
    return this._secret;
}

function _get_topology() {
    return system_store.get_local_cluster_info();
}

function _update_cluster_info(params) {
    var current_clustering = system_store.get_local_cluster_info();
    var owner_secret = current_clustering.oowner_secret;
    var update = _.defaults(_.pick(params, _.keys(current_clustering)), current_clustering);
    update.owner_secret = owner_secret; //Keep original owner_secret

    dbg.log0('Updating local cluster info for', owner_secret, 'previous cluster info',
        current_clustering, 'new cluster info', update);

    return system_store.make_changes({
        update: {
            clusters: [update]
        }
    });
}

//Recieves array in the cluster info form ([{address:X},{address:y}]) and returns the array of IPs
function _extract_servers_ip(arr) {
    var ips = [];
    _.each(arr, function(srv) {
        ips.push(srv.address);
    });
    return ips;
}
