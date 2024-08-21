/* Copyright (C) 2024 NooBaa */
"use strict";

async function run({ dbg, system_store }) {
    try {
        dbg.log0('starting upgrade accounts...');
        const accounts = system_store.data.accounts
            .map(a => a.password && ({
                _id: a._id,
                $unset: { password: true }
            }))
            .filter(Boolean);
        if (accounts.length > 0) {
            dbg.log0(`deleting "passwords" from accounts: ${accounts.map(b => b._id).join(', ')}`);
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
    description: 'Update accounts to remove "password" field'
};

