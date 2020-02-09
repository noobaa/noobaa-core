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
        isRemote: group.is_remote,
        region: group.region,
        endpointCount: group.endpoint_count,
        endpointRange: {
            min: group.min_endpoint_count,
            max: group.max_endpoint_count
        },
        cpuCount: group.cpu_count,
        cpuUsage: group.cpu_usage,
        memoryUsage: group.memory_usage,
        lastReportTime: group.last_report_time
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
