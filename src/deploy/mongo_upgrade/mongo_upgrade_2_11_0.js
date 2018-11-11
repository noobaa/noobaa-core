/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
'use strict';

update_spillover_tiers();

function update_spillover_tiers() {
    var has_none_internals = Boolean(db.nodes.findOne({ is_mongo_node: { $ne: true } }));
    var internal_pool = db.pools.findOne({ resource_type: "INTERNAL" });

    db.buckets.find().forEach(bucket => {
        var tiering = db.tieringpolicies.findOne({ _id: bucket.tiering });
        var first_tier_in_tiering = tiering.tiers[0];
        var second_tier_in_tiering = tiering.tiers[1];
        if (!second_tier_in_tiering || !second_tier_in_tiering.spillover) {
            print('update_spillover_tiers: no spillover tier');
            return;
        }
        var second_tier = db.tiers.findOne({ _id: second_tier_in_tiering.tier });
        var second_tier_first_mirror = second_tier && second_tier.mirrors && second_tier.mirrors[0];
        var t2_m1_s1 = second_tier_first_mirror && second_tier_first_mirror.spread_pools &&
            second_tier_first_mirror.spread_pools[0];
        var is_second_tier_internal = String(t2_m1_s1) === String(internal_pool._id);
        var chunks_tier;

        if (!has_none_internals) {
            print('update_spillover_tiers: first tier to become internal');
            db.tiers.remove({ _id: first_tier_in_tiering.tier });
            db.tieringpolicies.updateOne({ _id: tiering._id }, {
                $set: {
                    tiers: [{
                        order: 0,
                        tier: second_tier_in_tiering.tier,
                        spillover: false,
                        disabled: false
                    }]
                }
            });
            chunks_tier = second_tier_in_tiering.tier;
        } else if (is_second_tier_internal) {
            print('update_spillover_tiers: removing spillover tier');
            db.tiers.remove({ _id: second_tier_in_tiering._id });
            db.tieringpolicies.updateOne({ _id: tiering._id }, { $pop: { tiers: 1 } });
            chunks_tier = first_tier_in_tiering.tier;
        } else {
            print('update_spillover_tiers: keeping both tiers - spillover => normal 2 tier');
            db.tieringpolicies.updateOne({ _id: tiering._id }, {
                $set: {
                    tiers: [{
                        order: 0,
                        tier: first_tier_in_tiering.tier,
                        spillover: false,
                        disabled: first_tier_in_tiering.disabled,
                    }, {
                        order: 1,
                        tier: second_tier_in_tiering.tier,
                        spillover: false,
                        disabled: second_tier_in_tiering.disabled,
                    }]
                }
            });
            chunks_tier = first_tier_in_tiering.tier;
        }
        db.datachunks.updateMany({ bucket: bucket._id }, { $set: { tier: chunks_tier } });
        print('update_spillover_tiers: updating all chunks in bucket: ' + bucket.name + ' to tier: ' + chunks_tier);
    });
}
