/* Copyright (C) 2016 NooBaa */
"use strict";

const _ = require('lodash');

async function run({ dbg, mongo_client, system_store }) {
    try {
        const system_owner = _.get(system_store.data, 'systems.0.owner._id');
        await system_store.make_changes({
            update: {
                buckets: [{
                    $find: {
                        owner_account: { $exists: false }
                    },
                    $set: {
                        owner_account: system_owner
                    }
                }]
            }
        });
    } catch (err) {
        dbg.error('got error while updating bucket owner_account:', err);
        throw err;
    }
}


module.exports = {
    run,
    description: 'Sets the owner_account field for all buckets'
};
