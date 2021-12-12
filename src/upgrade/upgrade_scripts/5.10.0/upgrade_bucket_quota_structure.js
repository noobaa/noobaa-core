/* Copyright (C) 2021 NooBaa */
"use strict";

const util = require('util');

async function run({ dbg, db_client, system_store, system_server }) {

    try {
        dbg.log0('starting upgrade buckets quota...');
        const buckets = system_store.data.buckets
            .map(bucket => (bucket.quota && bucket.quota.unit && {
                _id: bucket._id,
                $set: { quota: {
                    size: {
                        value: bucket.quota.size,
                        unit: bucket.quota.unit.charAt(0)
                    }
                }}
            }))
            .filter(bucket => bucket);
        if (buckets.length > 0) {
            dbg.log0(`upgrading quota structure for these buckets: ${buckets.map(bucket => util.inspect(bucket)).join(', ')}`);
            await system_store.make_changes({ update: { buckets } });
        } else {
            dbg.log0('upgrade buckets quota: no upgrade needed...');
        }
    } catch (err) {
        dbg.error('got error while upgrading buckets quota:', err);
        throw err;
    }
}


module.exports = {
    run,
    description: 'Update buckets quota'
};
