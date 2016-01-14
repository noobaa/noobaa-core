/* jshint node:true */
'use strict';

var system_store = require('./stores/system_store');

/*
 * Cluster Server
 */

var cluster_server = {
    get_cluster_id: get_cluster_id,
};

module.exports = cluster_server;

/**
 *
 * GET_CLUSTER_ID
 *
 */
function get_cluster_id(req) {
    var cluster = system_store.clusters[0];
    return cluster ? cluster.cluster_id : '';
}
