/* Copyright (C) 2016 NooBaa */

import { keyByProperty } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import { mapApiStorage } from 'utils/state-utils';
import { COMPLETE_FETCH_SYSTEM_INFO } from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = undefined;

// ------------------------------
// Action Handlers
// ------------------------------
function onCompleteFetchSystemInfo(state, { payload }) {
    const { pools } = payload;
    const nodePools = pools.filter(pool => pool.resource_type === 'HOSTS');
    return keyByProperty(nodePools, 'name', pool => _mapPool(pool));
}

// ------------------------------
// Local util functions
// ------------------------------
function _mapPool(pool) {
    const activityList = (pool.data_activities.activities || [])
        .map(activity => ({
            kind: activity.reason,
            nodeCount: activity.count,
            progress: activity.progress,
            eta: activity.time.end
        }));

    return {
        name: pool.name,
        mode: pool.mode,
        storage: mapApiStorage(pool.storage),
        associatedAccounts: pool.associated_accounts,
        hostCount: pool.hosts.count,
        hostsByMode: pool.hosts.by_mode,
        storageNodeCount: pool.storage_nodes.count,
        storageNodesByMode: pool.storage_nodes.by_mode,
        endpointNodeCount: 0, // pool.s3_nodes.count
        endpointNodesByMode: {}, // pool.s3_nodes.by_mode
        undeletable: pool.undeletable,
        activities: {
            hostCount: pool.data_activities.host_count,
            list: activityList
        }
    };
}
// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
