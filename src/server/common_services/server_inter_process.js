/* Copyright (C) 2016 NooBaa */
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
async function load_system_store(req) {
    await system_store.load(
        req?.rpc_params?.since,
        req?.rpc_params?.load_source?.toUpperCase()
    );
}

// EXPORTS
exports.load_system_store = load_system_store;
