/**
 *
 * Cluster Member
 *
 */
'use strict';

var mongo_ctrl = require('../utils/mongo_ctrl');
var P = require('../../util/promise');
var dotenv = require('../../util/dotenv');
var dbg = require('../../util/debug_module')(__filename);
const system_store = require('../system_services/system_store').get_instance();

/**
 *
 */
function load_system_store(req) {
    return system_store.load().return();
}

function update_mongo_connection_string(req) {
    let old_url = process.env.MONGO_RS_URL || '';
    dotenv.load();
    dbg.log0('Recieved update mongo string. will update mongo url from', old_url, ' to ', process.env.MONGO_RS_URL);
    return P.when(mongo_ctrl.update_connection_string())
        .return();
}


// EXPORTS
exports.load_system_store = load_system_store;
exports.update_mongo_connection_string = update_mongo_connection_string;
