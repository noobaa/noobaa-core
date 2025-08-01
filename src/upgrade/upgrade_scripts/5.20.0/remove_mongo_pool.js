/* Copyright (C) 2025 NooBaa */
"use strict";

const config = require('../../../../config.js');

async function run({ dbg, system_store }) {
    try {
        dbg.log0(`Starting monogo pool delete...`);
        const internal_mongo_pool = `${config.INTERNAL_STORAGE_POOL_NAME}-${system_store.data.systems[0]._id}`;
        dbg.log0(`Internal mongo pool id is : ${internal_mongo_pool}`);
        const pool_ids = system_store.data.pools.filter(pool => pool.name === internal_mongo_pool);
        if (pool_ids.length > 0) {
            dbg.log0(`Removing default mongo pool: ${pool_ids[0]._id}`);
            await system_store.make_changes({ remove: { pools: [pool_ids[0]._id] }});
        } else {
            dbg.log0('Removing mongo pool: Could not find the mongo pool...');
        }
    } catch (err) {
        dbg.error('Got error while removing mongo pool:', err);
        throw err;
    }
}

module.exports = {
    run,
    description: 'Noobaa no longer support mongo_pool backingstore, Remove mongo pool',
};
