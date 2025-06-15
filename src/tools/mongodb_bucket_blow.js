/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
'use strict';

/*
 * mongodb script to add massive ammount of buckets to DB
 *
 * usage: mongo nbcore mongodb_bucket_blow.js
 *
 */

const system_id = db.systems.findOne()._id;
const pool_id = db.pools.findOne({ resource_type: { $ne: "INTERNAL" } })._id;
const ccc = db.chunk_configs.findOne()._id;
const now = Date.now();

for (let j = 0; j < 5; ++j) {
    const array_of_tiers = [];
    const array_of_policies = [];
    const array_of_buckets = [];
    for (let i = 0; i < 1000; ++i) {
        const tier_id = new ObjectId();
        const policy_id = new ObjectId();
        const bucket_id = new ObjectId();
        array_of_tiers.push({
            _id: tier_id,
            name: 'tier' + ((j * 1000) + i),
            system: system_id,
            chunk_config: ccc,
            data_placement: 'SPREAD',
            mirrors: [{
                _id: new ObjectId(),
                spread_pools: [pool_id],
            }],
            last_update: now,
        });
        array_of_policies.push({
            _id: policy_id,
            name: 'policy' + ((j * 1000) + i),
            system: system_id,
            tiers: [{
                tier: tier_id,
                order: 0,
                spillover: false,
                disabled: false
            }],
            chunk_split_config: {
                avg_chunk: 4194304,
                delta_chunk: 1048576
            },
            last_update: now
        });
        array_of_buckets.push({
            _id: bucket_id,
            name: 'bucket' + ((j * 1000) + i),
            tag: "",
            system: system_id,
            tiering: policy_id,
            storage_stats: {
                chunks_capacity: 0,
                objects_size: 0,
                objects_count: 0,
                stats_by_content_type: [],
                blocks_size: 0,
                pools: {},
                objects_hist: [],
                last_update: Date.now() - (2 * 90000)
            },
            versioning: "DISABLED",
            last_update: now,
        });
    }
    db.tiers.insert(array_of_tiers);
    db.tieringpolicies.insert(array_of_policies);
    db.buckets.insert(array_of_buckets);
}
