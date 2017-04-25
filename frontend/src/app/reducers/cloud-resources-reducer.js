/* Copyright (C) 2016 NooBaa */

import { keyBy, keyByProperty, flatMap, groupBy } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import { COMPLETE_FETCH_SYSTEM_INFO } from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {};

// ------------------------------
// Action Handlers
// ------------------------------

function onCompleteFetchSystemInfo(_, { info }) {
    const resources = info.pools.filter(_isPoolCloudResoruce);
    const bucketsByPools = _mapPoolsToBuckets(info.buckets, info.tiers);

    return keyByProperty(
        resources,
        'name',
        ({ name, cloud_info, storage, undeletable }) => ({
            name,
            type: cloud_info.endpoint_type,
            state: 'HEALTHY',
            target: cloud_info.target_bucket,
            storage: storage,
            usedBy: bucketsByPools[name] || [],
            undeletable
        })
    );
}

// ------------------------------
// Local util functions
// ------------------------------
function _isPoolCloudResoruce(pool) {
    return Boolean(pool.cloud_info);
}

function _mapPoolsToBuckets(buckets, tiers) {
    const bucketsByTierName = keyBy(
        buckets,
        bucket => bucket.tiering.tiers[0].tier,
        bucket => bucket.name
    );

    const pairs = flatMap(
        tiers,
        tier => tier.attached_pools.map(
            poolName => ({
                bucket: bucketsByTierName[tier.name],
                pool: poolName
            })
        )
    );

    return groupBy(
        pairs,
        pair => pair.pool,
        pair => pair.bucket
    );
}


// ------------------------------
// Exported reducer function.
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
