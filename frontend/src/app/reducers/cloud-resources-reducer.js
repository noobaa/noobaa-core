/* Copyright (C) 2016 NooBaa */

import { keyBy, keyByProperty, flatMap, groupBy } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import { COMPLETE_FETCH_SYSTEM_INFO, COMPLETE_FETCH_RESOURCE_STORAGE_HISTORY } from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {
    resources: {},
    storageHistory: []
};

// ------------------------------
// Action Handlers
// ------------------------------

function onCompleteFetchSystemInfo(cloudResources, { payload }) {
    const { pools, buckets, tiers } = payload;

    const bucketsByPools = _mapPoolsToBuckets(buckets, tiers);

    return {
        ...cloudResources,
        resources: /* move to var */keyByProperty(
            pools.filter(pool => pool.resource_type === 'CLOUD'),
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
        )
    };
}

function onCompleteFetchSystemUsageHistory(cloudResources, { payload }) {
    const history = payload;

    const storageHistory = history.map(
        ({timestamp, pool_list }) => {
            const storages = pool_list
                .filter(pool => pool.resource_type === 'CLOUD')
                .map(pool => pool.storage);

            return { timestamp, storages };
        }
    );

    return { ...cloudResources, storageHistory };
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
// Exported reducer function.
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo,
    [COMPLETE_FETCH_RESOURCE_STORAGE_HISTORY]: onCompleteFetchSystemUsageHistory
});
