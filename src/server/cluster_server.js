/* jshint node:true */
'use strict';

var db = require('./db');
var P = require('../util/promise');

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
    return P.when(db.Cluster.find()
            .exec())
        .then(function(id) {
            return id[0].cluster_id;
        });
}
