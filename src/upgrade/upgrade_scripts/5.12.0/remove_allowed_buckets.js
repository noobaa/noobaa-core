/* Copyright (C) 2022 NooBaa */
"use strict";

async function run({ dbg, system_store }) {
    try {
        dbg.log0('starting upgrade accounts...');
        const accounts = system_store.data.accounts
            .map(a => a.allowed_buckets && ({
                _id: a._id,
                $unset: { allowed_buckets: true }
            }))
            .filter(Boolean);
        if (accounts.length > 0) {
            dbg.log0(`deleting "allowed_buckets" from accounts: ${accounts.map(b => b._id).join(', ')}`);
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
    description: 'Update accounts to remove "allowed_buckets" field'
};

