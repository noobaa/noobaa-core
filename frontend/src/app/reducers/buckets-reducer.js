/* Copyright (C) 2016 NooBaa */

import { keyByProperty } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import { COMPLETE_FETCH_SYSTEM_INFO } from 'action-types';
// import { groupBy } from 'utils/core-utils';


// ------------------------------
// Initial State
// ------------------------------
const initialState = {};

// ------------------------------
// Action Handlers
// ------------------------------
function onCompleteFetchSystemInfo(state, { payload }) {

    const tiers = keyByProperty(payload.tiers, 'name');
    return keyByProperty(
        payload.buckets,
        'name',
        bucket => _mapBucket(bucket, tiers)
    );
}

// ------------------------------
// Local util functions
// ------------------------------
function _mapBucket(bucket, /*tiersByName*/) {
    // const enabledTiers = bucket.tiering.tiers
    //     .filter(record => !record.disabled);

    // const groups = groupBy(
    //     enabledTiers,
    //     record => record.spillover ? 'spillover' : 'placement',
    //     record => tiersByName[record.tier]
    // );

    // const spillover = groups.spillover[0].attached_pools[0];
    // const placement = {
    //     policyType: groups.placement[0].data_placement,
    //     resources: groups.placement[0].attached_pools
    // };

    // const usageByResource = keyByProperty(
    //     bucket.usage_by_pool,
    //     'pool_name',
    //     record => record.storage
    // );

    return {
        name: bucket.name,
        mode: bucket.mode,
        storage: bucket.storage.values,
        data: bucket.data,
        quota: bucket.quota,
        // placement: placement,
        // spillover: spillover
    };
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
