/* Copyright (C) 2016 NooBaa */

import { keyByProperty } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import { mapApiStorage } from 'utils/state-utils';
import {
    CREATE_HOSTS_POOL,
    COMPLETE_FETCH_SYSTEM_INFO
} from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = undefined;

const beingCreatedPoolState = {
    mode: 'BEING_CREATED',
    activities: {
        hostCount: 0,
        list: []
    },
    associatedAccounts: [],
    hostCount: 0,
    hostsByMode: {},
    storageNodeCount: 0,
    storageNodesByMode: {},
    endpointNodeCount: 0,
    endpointNodesByMode: {},
    storage: {
        total: 0,
        free: 0,
        unavailableFree: 0,
        used: 0,
        usedOther: 0,
        unavailableUsed: 0,
        reserved: 0
    }
};

// ------------------------------
// Action Handlers
// ------------------------------
function onCreateHostsPool(state, { payload }) {
    const { name } = payload;
    if (state[name]) return state;

    return {
        [name]: {
            ...beingCreatedPoolState,
            name,
            creationTime: Date.now()
        },
        ...state
    };
}

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
        creationTime: pool.create_time,
        mode: pool.mode,
        storage: mapApiStorage(pool.storage),
        associatedAccounts: pool.associated_accounts,
        hostCount: pool.hosts.count,
        hostsByMode: pool.hosts.by_mode,
        storageNodeCount: pool.storage_nodes.count,
        storageNodesByMode: pool.storage_nodes.by_mode,
        endpointNodeCount: pool.s3_nodes.count,
        endpointNodesByMode: pool.s3_nodes.by_mode,
        undeletable: pool.undeletable,
        region: pool.region,
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
    [CREATE_HOSTS_POOL]: onCreateHostsPool,
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
