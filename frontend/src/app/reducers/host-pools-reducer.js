/* Copyright (C) 2016 NooBaa */

import { keyBy, keyByProperty, flatMap, groupBy } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import {
    FETCH_SYSTEM_INFO,
    COMPLETE_FETCH_SYSTEM_INFO,
    FAIL_FETCH_SYSTEM_INFO
} from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {
    fetching: false,
    items: undefined
};

// ------------------------------
// Action Handlers
// ------------------------------
function onFetchSystemInfo(state) {
    return {
        ...state,
        fetching: true
    };
}

function onCompleteFetchSystemInfo(state, { payload }) {
    const { pools, buckets, tiers } = payload;
    const nodePools = pools.filter(pool => pool.resource_type === 'HOSTS');
    const bucketMapping = _mapPoolsToBuckets(buckets, tiers);

    const items = keyByProperty(nodePools, 'name', pool => {
        const activityList = (pool.data_activities || [])
            .map(activity => ({
                type: activity.reason,
                nodeCount: activity.count,
                progress: activity.progress,
                eta: activity.time.end
            }));

        return {
            name: pool.name,
            mode: pool.mode,
            storage: pool.storage,
            associatedAccounts: pool.associated_accounts,
            connectedBuckets: bucketMapping[pool.name] || [],
            hostCount: pool.hosts.count,
            hostsByMode: pool.hosts.by_mode,
            undeletable: pool.undeletable,
            activities: {
                hostCount: 0, // TODO: replace with read number when provided.
                list: activityList
            }
        };
    });

    return {
        ...state,
        items: items,
        fetching: false,
    };
}

function onFailFetchSystemInfo(state) {
    return {
        ...state,
        fetching: false
    };
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
    [FETCH_SYSTEM_INFO]: onFetchSystemInfo,
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo,
    [FAIL_FETCH_SYSTEM_INFO]: onFailFetchSystemInfo
});
