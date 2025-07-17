/* Copyright (C) 2016 NooBaa */
/**
 *
 * Cluster Member
 *
 */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const system_store = require('../system_services/system_store').get_instance();
const server_rpc = require('../server_rpc');


/**
 *
 */
async function load_system_store(req) {
    await system_store.load(
        req && req.rpc_params && req.rpc_params.since
    );
}


function update_master_change(req) {
    system_store.is_cluster_master = req.rpc_params.is_master;
    if (req.rpc_params.master_address) {
        const new_master_address = req.rpc_params.master_address;
        const old_master_address = server_rpc.rpc.router.master;
        // old_master_address is of the form ws://addr:port. check if new_master_address is differnet
        if (old_master_address.indexOf(new_master_address) === -1) {
            dbg.log0(`master changed from ${old_master_address} to ${new_master_address}. updating server_rpc`);
            server_rpc.set_new_router({
                master_address: new_master_address
            });
        }
    }
}


// EXPORTS
exports.load_system_store = load_system_store;
exports.update_master_change = update_master_change;
