/* Copyright (C) 2016 NooBaa */
"use strict";
const _ = require('lodash');

async function run({ dbg, system_store, system_server}) {
    try {
        dbg.log0('starting upgrade master keys...');
        if (_.isEmpty(system_store.data.master_keys_by_id)) {
            await system_server.upgrade_master_keys();
                dbg.log0('finished upgrading master keys.');
        }
        dbg.log0('upgrade master keys: no upgrade needed...');
    } catch (err) {
        dbg.error('got error while upgrading master keys:', err);
        throw err;
    }
}


module.exports = {
    run,
    description: 'Create master keys for existing entities (system, account, bucket) and encrypt secrets'
};
