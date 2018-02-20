/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
'use strict';

update_spillover_tiers();

function update_spillover_tiers() {
    var old_tier = db.tiers.findOne({ name: /^system-internal-spillover-tier/ });
    if (old_tier) {
        db.buckets.find().forEach(bucket => {
            var tier_id = new ObjectId();
            var insert = {
                _id: tier_id,
                name: 'bucket-spillover-tier-' + bucket._id.str,
                system: bucket.system,
                chunk_config: old_tier.chunk_config,
                data_placement: old_tier.data_placement,
                mirrors: old_tier.mirrors,
            };
            if (bucket.deleted) {
                insert.deleted = bucket.deleted;
            }
            print('update_spillover_tiers: creating new tier for bucket', bucket.name);
            printjson(insert);
            db.tiers.insertOne(insert);
            print('update_spillover_tiers: updating tiering policy for bucket', bucket.name, bucket.tiering);
            var query = {
                _id: bucket.tiering,
                'tiers.tier': old_tier._id
            };
            var update = {
                $set: {
                    'tiers.$.tier': tier_id
                }
            };
            print('update_spillover_tiers: updating tiering policy for bucket', bucket.name, bucket.tiering);
            printjson(query);
            printjson(update);
            db.tieringpolicies.updateOne(query, update);
        });
        print('update_spillover_tiers: removing system spillover tier', old_tier._id);
        db.tiers.remove({
            _id: old_tier._id
        });
    }
}
