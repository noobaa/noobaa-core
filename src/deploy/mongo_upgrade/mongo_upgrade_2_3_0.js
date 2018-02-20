/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
'use strict';

update_tier_mirror_ids();

function update_tier_mirror_ids() {
    var old_tier = db.tiers.findOne({ name: /^system-internal-spillover-tier/ });
    if (old_tier) {
        db.buckets.find().forEach(bucket => {
            var tier_id = new ObjectId();
            db.tiers.insertOne({
                _id: tier_id,
                name: 'bucket-spillover-tier-' + bucket._id.str,
                system: bucket.system,
                chunk_config: old_tier.chunk_config,
                data_placement: old_tier.data_placement,
                mirrors: old_tier.mirrors
            });
            db.tieringpolicies.updateOne({
                _id: bucket.tiering,
                'tiers.tier': old_tier._id
            }, {
                $set: {
                    'tiers.$.tier': tier_id
                }
            });
        });
        db.tiers.remove({
            _id: old_tier._id
        });
    }
}
