/* Copyright (C) 2016 NooBaa */
'use strict';

/* sample event:
    {
        "name": "bucket_name",
        "data_placement": "SPREAD",
        "pools": ["win"]
    }
*/


exports.handler = function(event, context, callback) {

    if (!event.pools || !Array.isArray(event.pools)) return callback(new Error('Missing event.pools [array]'));
    if (event.data_placement && event.data_placement !== "SPREAD" && event.data_placement !== "MIRROR") return callback(new Error('data_placement must be "SPREAD" or "MIRROR"'));

    const bucket_with_suffix = `${event.name}#${Date.now().toString(36)}`;
    context.rpc_client.tier.create_tier({
            name: bucket_with_suffix,
            data_placement: event.data_placement || "SPREAD",
            attached_pools: event.pools
        })
        .then(
            tier => {
                const policy = {
                    name: bucket_with_suffix,
                    tiers: [{ order: 0, tier: tier.name }]
                };

                return context.rpc_client.tiering_policy.create_policy(policy)
                    .then(
                        () => policy
                    );
            }
        )
        .then(
            policy => context.rpc_client.bucket.create_bucket({
                name: event.name,
                tiering: policy.name
            })
        )
        .then(res => callback(null, JSON.stringify(res)))
        .catch(err => callback(err));
};
