/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { keyByProperty } from 'utils/core-utils';
import { COMPLETE_FETCH_SYSTEM_INFO } from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = undefined;

// ------------------------------
// Action Handlers
// ------------------------------

// An example of an action handler
function onCompleteFetchSystemInfo(state, { payload }) {
    return keyByProperty(payload.endpoint_groups, 'group_name', group => ({
        name: group.group_name,
        lastUpdate: group.last_update,
        endpointCount: group.endpoint_count,
        cpuCount: group.cpu_count,
        cpuUsage: group.cpu_usage,
        memoryUsage: group.memory_usage
    }));
}

// ------------------------------
// Local util functions
// ------------------------------

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
