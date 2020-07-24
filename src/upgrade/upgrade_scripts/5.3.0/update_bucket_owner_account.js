/* Copyright (C) 2016 NooBaa */
"use strict";

const _ = require('lodash');

async function run({ dbg, system_store }) {
    try {
        const system_owner = _.get(system_store.data, 'systems.0.owner._id');
        const buckets = system_store.data.buckets
            .filter(b => !b.owner_account)
            .map(b => ({
                _id: b._id,
                $set: { owner_account: system_owner }
            }));
        if (buckets.length > 0) {
            dbg.log0(`updating owner_account (${system_owner}) to these buckets: ${buckets.map(b => b._id).join(', ')}`);
            await system_store.make_changes({ update: { buckets } });
        } else {
            dbg.log0('there are no buckets that need owner_account update');
        }
    } catch (err) {
        dbg.error('got error while updating bucket owner_account:', err);
        throw err;
    }
}


module.exports = {
    run,
    description: 'Sets the owner_account field for all buckets'
};
