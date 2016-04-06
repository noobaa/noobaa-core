/* jshint node:true */
'use strict';

/*
 * Cluster Server
 */

var cluster_server = {
    _init: _init,

    get_cluster_id: get_cluster_id,
    add_members_to_cluster: add_members_to_cluster,
    join_to_cluster: join_to_cluster,
    heartbeat: heartbeat,
};

module.exports = cluster_server;

var _ = require('lodash');
var fs = require('fs');
var system_store = require('./stores/system_store');
var server_rpc = require('./server_rpc');
var P = require('../util/promise');
var dbg = require('../util/debug_module')(__filename);

var SECRET;
var CLUSTER_TOPOLOGY_FILE = '/etc/noobaa_cluster';
var TOPOLOGY;

function _init() {
    return P.nfcall(fs.readFile, '/etc/noobaa_sec')
        .then(function(data) {
            SECRET = data.toString();
            SECRET = SECRET.substring(0, SECRET.length - 1);
            console.warn('NBNB:: SECRET is', SECRET);
        })
        .fail(function(err) {
            if (err.code === 'ENOENT') {
                console.error('No noobaa_sec file exists');
            }
            return;
        })
        .then(function() {
            return P.nfcall(fs.stat, CLUSTER_TOPOLOGY_FILE);
        })
        .then(function(exists) {
            return P.nfcall(fs.readFile, CLUSTER_TOPOLOGY_FILE);
        })
        .then(function(top) {
            TOPOLOGY = JSON.parse(top);
        })
        .fail(function(err) {
            if (err.code !== 'ENOENT') {
                console.error('Topology file corrupted');
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

function add_members_to_cluster(req) {
    dbg.log0('Recieved add members to cluster req', req.rpc_params);
    var id = get_cluster_id(req).cluster_id.toString();
    return P.each(req.rpc_params, function(server) {
            return server_rpc.client.cluster_server.join_to_cluster({
                ips: ['1.1.1.1', '2.2.2.2', '3.3.3.3'],
                cluster_id: id,
                secret: server.secret,
            }, {
                address: 'ws://' + server.ip + ':8080',
                timeout: 60000 //60s
            });
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
        //else
        //Server is already part of this cluster, all is well
        //TODO:: need to think regarding role switch: ReplicaSet chain vs. Shard (or switching between
        //different ReplicaSet Chains)
        return;
    }

    //So far so good, write the topology file
    TOPOLOGY = {};
    TOPOLOGY.cluster_id = req.rpc_params.cluster_id;
    TOPOLOGY.servers = [];
    _.each(req.rpc_params.ips, function(ip) {
        TOPOLOGY.servers.push(ip);
    });

    return P.nfcall(fs.writeFile, CLUSTER_TOPOLOGY_FILE, JSON.stringify(TOPOLOGY))
        .then(function() {
            //TODO:: update mongodb
            return;
        });
}

function heartbeat(req) {

}
