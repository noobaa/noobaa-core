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
function onCompleteFetchSystemInfo(state, { payload }) {
    const { pools, buckets, tiers } = payload;
    const nodePools = pools.filter(pool => pool.resource_type === 'HOSTS');
    const bucketMapping = _mapPoolsToBuckets(buckets, tiers);
    return keyByProperty(nodePools, 'name', pool => {
        const {
            name,
            mode,
            storage,
            associated_accounts: associatedAccounts,
        } = pool;
        const connectedBuckets = bucketMapping[pool.name] || [];

        return { name, mode, storage, associatedAccounts, connectedBuckets };
    });
}

// ------------------------------
// Local util functions
// ------------------------------
function _mapPoolsToBuckets(buckets, tiers) {
    const bucketsByTierName = keyBy(
        buckets,
        bucket => bucket.tiering.tiers[0].tier,
        bucket => bucket.name
    );

    const pairs = flatMap(
        tiers,
        tier => tier.attached_pools.map(pool => ({
            bucket: bucketsByTierName[tier.name],
            pool
        }))
    );

    return groupBy(
        pairs,
        pair => pair.pool,
        pair => pair.bucket
    );
}
// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
