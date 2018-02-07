/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
'use strict';

update_tier_mirror_ids();

function update_tier_mirror_ids() {
    db.tiers.find().forEach(tier => {
        var set_updates;
        tier.mirrors.forEach((mirror, i) => {
            if (!mirror._id) {
                set_updates = set_updates || {};
                set_updates[`mirrors.${i}._id`] = new ObjectId();
            }
        });
        if (set_updates) {
            print('update_tier_mirror_ids: updating tier', tier.name, tier._id);
            printjson(set_updates);
            db.tiers.updateOne({ _id: tier._id }, { $set: set_updates });
        }
    });
}
