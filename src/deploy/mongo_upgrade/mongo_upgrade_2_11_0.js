/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
'use strict';

update_spillover_tiers();

function update_spillover_tiers() {
    var has_none_internals = Boolean(db.pools.findOne({ resource_type: { $ne: "INTERNAL" } }));
    var internal_pool = db.pools.findOne({ resource_type: "INTERNAL" });
    var has_internal_data = internal_pool.storage_stats > 0;

    db.buckets.find().forEach(bucket => {
        var tiering = db.tieringpolicies.findOne({ _id: bucket.tiering });
        var first_tier_in_tiering = tiering.tiers[0];
        var second_tier_in_tiering = tiering.tiers[1];
        if (!second_tier_in_tiering || !second_tier_in_tiering.spillover) {
            print('update_spillover_tiers: no spillover tier');
            return;
        }
        var second_tier = db.tiers.findOne({ _id: second_tier_in_tiering._id });
        var second_tier_first_mirror = second_tier && second_tier.mirrors && second_tier.mirrors[0];
        var t2_m1_s1 = second_tier_first_mirror && second_tier_first_mirror.spread_pools &&
            second_tier_first_mirror.spread_pools[0];
        var is_second_tier_internal = String(t2_m1_s1._id) === String(internal_pool._id);

        if (!has_none_internals && (!second_tier_in_tiering.disabled || (second_tier_in_tiering.disabled && has_internal_data))) {
            print('update_spillover_tiers: first tier to become internal');
            db.tiers.remove({ _id: first_tier_in_tiering._id });
            db.tieringpolicies.updateOne({ _id: tiering._id }, {
                $set: {
                    tiers: [{
                        order: 0,
                        tier: second_tier_in_tiering._id,
                        spillover: false,
                        disabled: false
                    }]
                }
            });
        } else if (is_second_tier_internal) {
            print('update_spillover_tiers: removing spillover tier');
            db.tiers.remove({ _id: second_tier_in_tiering._id });
            db.tieringpolicies.updateOne({ _id: tiering._id }, { $pop: { tiers: 1 } });
        } else {
            print('update_spillover_tiers: keeping both tiers - spillover => normal 2 tier');
            db.tieringpolicies.updateOne({ _id: tiering._id }, {
                $set: {
                    tiers: [{
                        order: 0,
                        tier: first_tier_in_tiering._id,
                        spillover: false,
                        disabled: first_tier_in_tiering.disabled,
                    }, {
                        order: 1,
                        tier: second_tier_in_tiering._id,
                        spillover: false,
                        disabled: second_tier_in_tiering.disabled,
                    }]
                }
            });
        }
    });
}
