/**
 *
 * Cluster Member
 *
 */
'use strict';

const system_store = require('../system_services/system_store').get_instance();

/**
 *
 */
function load_system_store(req) {
    return system_store.load().return();
}


// EXPORTS
exports.load_system_store = load_system_store;
