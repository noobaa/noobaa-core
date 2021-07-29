/* Copyright (C) 2016 NooBaa */
"use strict";

async function run({ dbg, system_store, system_server }) {

    try {
        dbg.log0('starting upgrade accounts...');
        const accounts = system_store.data.accounts
            .map(a => a.default_pool && ({
                _id: a._id,
                $set: { default_resource: a.default_pool },
                $unset: { default_pool: true }
            }))
            .filter(account => account);
        if (accounts.length > 0) {
            dbg.log0(`replacing account default_pool by default_resource: ${accounts.map(b => b._id).join(', ')}`);
            await system_store.make_changes({ update: { accounts } });
        } else {
            dbg.log0('upgrade accounts: no upgrade needed...');
        }
    } catch (err) {
        dbg.error('got error while upgrading accounts:', err);
        throw err;
    }
}


module.exports = {
    run,
    description: 'Update accounts default_pool to default_resource and namespace bucket structure'
};
