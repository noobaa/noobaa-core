/* jshint node:true */
'use strict';

var system_store = require('./stores/system_store');
var api = require('../../api');
var rpc = api.new_rpc();

/*
 * Cluster Server
 */

var cluster_server = {
    get_cluster_id: get_cluster_id,
    add_member_to_cluster: add_member_to_cluster,
    join_to_cluster: join_to_cluster,
};

module.exports = cluster_server;

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

    return;
}

function join_to_cluster(req) {
    //Verify secret is correct
    //update cluster info
    //update mongodb
    return;
}
