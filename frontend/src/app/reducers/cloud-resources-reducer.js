/* Copyright (C) 2016 NooBaa */

import { keyBy, keyByProperty, flatMap, groupBy } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import { mapApiStorage } from 'utils/state-utils';
import { COMPLETE_FETCH_SYSTEM_INFO } from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {};

// ------------------------------
// Action Handlers
// ------------------------------

function onCompleteFetchSystemInfo(_, { payload }) {
    const { pools, buckets, tiers } = payload;

    const bucketsByPools = _mapPoolsToBuckets(buckets, tiers);

    return keyByProperty(
        pools.filter(pool => pool.resource_type === 'CLOUD'),
        'name',
        res => _mapResource(res, bucketsByPools)
    );
}

// ------------------------------
// Local util functions
// ------------------------------
function _mapResource(resource, bucketsByPools) {
    const { name, mode, cloud_info, storage, undeletable } = resource;
    return {
        name,
        mode,
        type: cloud_info.endpoint_type,
        target: cloud_info.target_bucket,
        storage: mapApiStorage(storage),
        usedBy: bucketsByPools[name] || [],
        undeletable
    };
}

function _mapTiersToBucket(buckets) {
    const pairs = flatMap(
        buckets,
        bucket => bucket.tiering.tiers
            .map(item => {
                const bucketName = bucket.name;
                const tierName = item.tier;
                return { bucketName, tierName };
            })
    );

    return keyBy(
        pairs,
        pair => pair.tierName,
        pair => pair.bucketName
    );
}

function _mapPoolsToBuckets(buckets, tiers) {
    const bucketsByTierName = _mapTiersToBucket(buckets);
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
