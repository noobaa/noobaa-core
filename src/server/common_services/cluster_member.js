/**
 *
 * Cluster Member
 *
 */
'use strict';

var system_store = require('../stores/system_store');

/**
 *
 */
function load_system_store(req) {
    return system_store.load().return();
}


// EXPORTS
exports.load_system_store = load_system_store;
