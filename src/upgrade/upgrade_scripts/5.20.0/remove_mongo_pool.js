/* Copyright (C) 2025 NooBaa */
"use strict";
const _ = require('lodash');

const config = require('../../../../config.js');
const SensitiveString = require('../../../util/sensitive_string');


async function run({ dbg, system_store }) {
    try {
        dbg.log0(`Start: Monogo pool upgrade script...`);
        dbg.log0(`Start: Create new default pool...`);
        const pool_name = `${config.DEFAULT_POOL_NAME}`;
        //const pool_name = `${config.DEFAULT_POOL_NAME}-${system_store.data.systems[0]._id}`;
        const default_pool = system_store.data.systems[0].pools_by_name[pool_name];
        if (!default_pool) {
            await create_new_default_pool(dbg, pool_name, system_store);
            dbg.log0(`End: Create new default pool Created...`);
        }

        const internal_mongo_pool = `${config.INTERNAL_STORAGE_POOL_NAME}-${system_store.data.systems[0]._id}`;
        dbg.log0(`Internal mongo pool id is : ${internal_mongo_pool}`);
        const mongo_pools = system_store.data.pools.filter(pool => (pool.mongo_info || pool.resource_type === 'INTERNAL'));

        dbg.log0(`Start: Update bucket default bucket pool with new default pool...`);
        await update_buckets_default_pool(dbg, pool_name, mongo_pools[0], system_store);
        dbg.log0(`End: Updated bucket default bucket pool with new default pool...`);

        if (mongo_pools.length > 0) {
            dbg.log0(`Removing default mongo pool: ${mongo_pools[0]._id}`);
            await system_store.make_changes({ remove: { pools: [mongo_pools[0]._id] }});
        } else {
            dbg.log0('Removing mongo pool: Could not find the mongo pool...');
        }
        dbg.log0(`End: Monogo pool upgrade script...`);
    } catch (err) {
        dbg.error('Got error while removing mongo pool:', err);
        throw err;
    }
}

async function update_buckets_default_pool(dbg, pool_name, mongo_pool, system_store) {
    const pool = system_store.data.systems[0].pools_by_name[pool_name];
    if (!pool) {
        dbg.error('INVALID_POOL_NAME:');
         throw new Error('INVALID_POOL_NAME');
    }
    if (!mongo_pool || !mongo_pool._id) return;
    if (String(pool._id) === String(mongo_pool._id)) return;
    const buckets_with_internal_pool = _.filter(system_store.data.systems[0].buckets_by_name, bucket =>
        is_using_internal_storage(bucket, mongo_pool));
    if (!buckets_with_internal_pool.length) return;

    // The loop pushes one update per bucket
    const updates = _.uniqBy([], '_id');
    for (const bucket of buckets_with_internal_pool) {
        updates.push({
            _id: bucket.tiering.tiers[0].tier._id,
            mirrors: [{
                _id: system_store.new_system_store_id(),
                spread_pools: [pool._id]
            }]
        });
    }
    dbg.log0(`Updating ${buckets_with_internal_pool.length} buckets to use ${pool_name} as default resource`);
    await system_store.make_changes({
        update: {
            tiers: updates
        }
    });
}

async function create_new_default_pool(dbg, pool_name, system_store) {
    // TODO: UPDATE EMAIL
    let account = system_store.get_account_by_email(new SensitiveString('admin@noobaa.io'));
    if (!account) {
        dbg.error('NO_SUCH_ACCOUNT', 'No such account email: admin@noobaa.io');
        // For testing
        account = system_store.get_account_by_email(new SensitiveString(config.OPERATOR_ACCOUNT_EMAIL));
    }
    const fs_pool = new_pool_defaults(system_store, pool_name, system_store.data.systems[0]._id, 'HOSTS', 'BLOCK_STORE_FS', account._id);
    fs_pool.hosts_pool_info = { is_managed: false, host_count: 0 };
    const default_pool = fs_pool;
    await system_store.make_changes({
        insert: {
            pools: [default_pool]
        }
    });
}

function new_pool_defaults(system_store, name, system_id, resource_type, pool_node_type, owner_id) {
    const now = Date.now();
    return {
        _id: system_store.new_system_store_id(),
        system: system_id,
        name: name,
        owner_id,
        resource_type: resource_type,
        pool_node_type: pool_node_type,
        storage_stats: {
            blocks_size: 0,
            last_update: now - (2 * config.MD_GRACE_IN_MILLISECONDS)
        },
    };
}

function is_using_internal_storage(bucket, internal_pool) {
    if (!internal_pool || !internal_pool._id) return false;
    const tiers = bucket.tiering && bucket.tiering.tiers;
    if (!tiers || tiers.length !== 1) return false;
    const mirrors = tiers[0].tier.mirrors;
    if (mirrors.length !== 1) return false;
    const spread_pools = mirrors[0].spread_pools;
    if (spread_pools.length !== 1) return false;

    return String(spread_pools[0]._id) === String(internal_pool._id);
}

module.exports = {
    run,
    description: 'Noobaa no longer support mongo_pool backingstore, Remove mongo pool',
};
