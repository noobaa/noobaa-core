/* Copyright (C) 2025 NooBaa */
"use strict";

const config = require('../../../../config.js');

async function run({ dbg, system_store }) {
    try {
        console.log('Starting monogo pool delete...', system_store);
        const internal_mongo_pool = `${config.INTERNAL_STORAGE_POOL_NAME}-${system_store.data.systems._id}`;
        console.log(`Internal mongo pool id is : ${internal_mongo_pool}`);
        const pool_id = system_store.data.pools
            .filter(pool => pool.name === internal_mongo_pool);
        if (pool_id) {
            console.log(`Removing default mongo pool: ${pool_id}`);
            await system_store.make_changes({ remove: { pools: [pool_id] }});
        } else {
            console.log('Removing mongo pool: Could not find the mongo pool...');
        }
    } catch (err) {
        dbg.error('Got error while removing mongo pool:', err);
        throw err;
    }
}

//run({ dbg, system_store })

module.exports = {
    run,
    description: 'Noobaa no longer support mongo_pool backingstore, Remove mongo pool',
};
