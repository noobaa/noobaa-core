/* Copyright (C) 2016 NooBaa */

import { keyBy, keyByProperty, flatMap, groupBy } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import { COMPLETE_FETCH_SYSTEM_INFO, COMPLETE_FETCH_RESOURCE_STORAGE_HISTORY } from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {
    pools: {},
    nodes: {},
    storageHistory: []
};

// ------------------------------
// Action Handlers
// ------------------------------
function onCompleteFetchSystemInfo(state, { payload }) {
    const { pools, buckets, tiers, nodes } = payload;
    const nodePools = pools.filter(pool => pool.resource_type === 'HOSTS');
    const bucketMapping = _mapPoolsToBuckets(buckets, tiers);
    const poolsByName = keyByProperty(nodePools, 'name', pool => {
        const {
            name,
            mode,
            storage,
            associated_accounts: associatedAccounts,
        } = pool;
        const associatedBuckets = bucketMapping[pool.name] || [];

        return { name, mode, storage, associatedAccounts, associatedBuckets };
    });

    return { ...state, pools: poolsByName, nodes: nodes.by_mode };
}

function onCompleteFetchSystemUsageHistory(nodePools, { payload }) {
    const history = payload;

    const storageHistory = history.map(
        ({timestamp, pool_list }) => {
            const storages = pool_list
                .filter(pool => pool.resource_type === 'HOSTS')
                .map(pool => pool.storage);

            return { timestamp, storages };
        }
    );

    return { ...nodePools, storageHistory };
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
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo,
    [COMPLETE_FETCH_RESOURCE_STORAGE_HISTORY]: onCompleteFetchSystemUsageHistory
});
