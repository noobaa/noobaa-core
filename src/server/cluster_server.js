/* jshint node:true */
'use strict';

// var _ = require('lodash');
var system_store = require('./stores/system_store');

/*
 * Cluster Server
 */

var cluster_server = {
    get_cluster_id: get_cluster_id,
    load_system_store: load_system_store,
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

/**
 *
 */
function load_system_store(req) {
    return system_store.load().return();
}
