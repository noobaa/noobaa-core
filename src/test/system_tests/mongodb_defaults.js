/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
'use strict';

/*
 * mongodb script to restore the initial state of the database
 *
 * usage: mongo nbcore mongodb_init.js
 *
 */
db.datablocks.remove({});
db.datachunks.remove({});
db.objectparts.remove({});
db.objectmds.remove({});
db.tiers.update({
    name: {
        $regex: 'first\\.bucket.*'
    }
}, {
    $set: {
        data_placement: 'SPREAD',
        mirrors: [{
            spread_pools: [
                db.pools.find({
                    name: 'first.pool'
                })[0]._id
            ]
        }]
    }
});
db.pools.remove({
    name: {
        $nin: ['first.pool', /system-internal-storage-pool.*/]
    }
});
db.tiers.remove({
    name: {
        $nin: [/first\.bucket#/, /system-internal-spillover-tier.*/]
    }
});
db.tieringpolicies.remove({
    name: {
        $nin: [/first\.bucket#/]
    }
});
db.buckets.remove({
    name: {
        $ne: 'first.bucket'
    }
});

db.nodes.remove({
    name: {
        $regex: 'noobaa-internal.*'
    },
    pool: {
        $nin: [db.pools.find({
            name: {
                $regex: 'system-internal-storage-pool.*'
            }
        })[0]._id]
    }
});

db.buckets.updateMany({}, {
    $unset: {
        cloud_sync: true
    },
    $set: {
        storage_stats: {
            chunks_capacity: 0,
            blocks_size: 0,
            objects_size: 0,
            pools: {},
            objects_count: 0,
            objects_hist: [],
            last_update: Date.now() - 600000
        }
    }
});

db.pools.updateMany({}, {
    $set: {
        storage_stats: {
            blocks_size: 0,
            last_update: Date.now() - 600000
        }
    }
});

// We assign all of the nodes to the first.pool, because we've removed all of the pools
db.nodes.update({}, {
    $set: {
        pool: db.pools.find({
            name: 'first.pool'
        })[0]._id
    },
    $unset: {
        issues_report: 1
    }
}, {
    multi: true
});
// Removing all accounts except Support and Owner
db.accounts.remove({
    email: {
        $nin: ['demo@noobaa.com', 'support@noobaa.com']
    }
});

// Update owner allowed_buckets to files bucket only
db.accounts.update({
    email: 'demo@noobaa.com'
}, {
    $set: {
        allowed_buckets: {
            full_permission: true
        }
    }
});

// Removing roles of the deleted accounts, except demo and support (which doesn't have a role)
db.roles.remove({
    account: {
        $nin: [db.accounts.find({
            email: 'demo@noobaa.com'
        })[0]._id]
    }
});

//clean cloud sync credential cache
db.accounts.updateMany({}, {
    $unset: {
        sync_credentials_cache: true
    }
});
