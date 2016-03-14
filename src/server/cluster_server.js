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

var fs = require('fs');
var system_store = require('./stores/system_store');
var server_rpc = require('./server_rpc');
var P = require('../util/promise');
var dbg = require('../util/debug_module')(__filename);

var SECRET;

function _init() {
    return P.nfcall(fs.readFile, '/etc/noobaa_sec')
        .then(function(data) {
            SECRET = data.toString();
            SECRET = SECRET.substring(0, SECRET.length - 1);
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
    var id = get_cluster_id(req).toString();
    return P.each(req.rpc_params, function(server) {
            console.warn('NBNB:: calling ', server);
            return server_rpc.client.cluster_server.join_to_cluster({
                ips: ['1.1.1.1', '2.2.2.2', '3.3.3.3'],
                cluster_id: id,
                secret: server.secret,
            }, {
                address: 'ws://' + server.ip + ':8080',
                timeout:  60000 //60s
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

    //TODO:: Verify not already member of a cluster, this one or another
    //TODO:: update cluster info
    //TODO:: update mongodb
    return;
}

function heartbeat(req) {

}
