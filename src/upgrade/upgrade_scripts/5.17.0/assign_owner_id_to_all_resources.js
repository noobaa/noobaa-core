/* Copyright (C) 2024 NooBaa */
"use strict";

const config = require('../../../../config');

async function run({ dbg, system_store }) {

    try {
        const operator_account = system_store.accounts.find(account => account.email.unwrap() === config.OPERATOR_ACCOUNT_EMAIL);
        const operator_account_id = operator_account._id;
        dbg.log0('Assigning account ID ', operator_account_id, ' as owner_id to all pools and resources');
        const updated_pools = system_store.data.pools
            .filter(pool => !pool.owner_id)
            .map(pool => ({
                _id: pool._id,
                $set: { 'owner_id': operator_account_id }
            }));
        if (updated_pools.length > 0) {
            dbg.log0('Assigning ownership to all pools');
            await system_store.make_changes({ update: { pools: updated_pools } });
        }
    } catch (err) {
        dbg.error('An error ocurred in the upgrade process:', err);
        throw err;
    }
}

module.exports = {
    run,
    description: 'Assign an owner_id to all resources and pools based on the ID of the system owner'
};
