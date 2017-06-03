/* Copyright (C) 2016 NooBaa */

import { keyBy, keyByProperty, flatMap, groupBy } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import {
    COMPLETE_FETCH_SYSTEM_INFO,
    COMPLETE_FETCH_RESOURCE_STORAGE_HISTORY
} from 'action-types';

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

    const resources = keyByProperty(
        pools.filter(pool => pool.resource_type === 'CLOUD'),
        'name',
        ({ name, cloud_info, storage, undeletable, mode }) => ({
            name,
            type: cloud_info.endpoint_type,
            mode: mode,
            target: cloud_info.target_bucket,
            storage: storage,
            usedBy: bucketsByPools[name] || [],
            undeletable
        })
    );

    return {
        ...cloudResources,
        resources
    };
}

function onCompleteFetchSystemUsageHistory(cloudResources, { payload }) {
    const history = payload;

    const storageHistory = history.map(
        ({timestamp, pool_list }) => {
            const samples = keyByProperty(pool_list
                .filter(pool => pool.resource_type === 'CLOUD'),
                'name',
                ({ storage }) => storage
            );

            return { timestamp, samples };
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
