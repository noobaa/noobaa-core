/* jshint node:true */
'use strict';

var system_store = require('./stores/system_store');

/*
 * Cluster Member
 */

var cluster_member = {
    load_system_store: load_system_store,
};

module.exports = cluster_member;

/**
 *
 */
function load_system_store(req) {
    return system_store.load().return();
}
