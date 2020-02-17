/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import {
    FETCH_ENDPOINTS_HISTORY,
    COMPLETE_FETCH_ENDPOINTS_HISTORY,
    FAIL_FETCH_ENDPOINTS_HISTORY,
    DROP_ENDPOINTS_HISTORY
} from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {
    query: undefined,
    samples: undefined,
    fetching: false,
    error: false
};

// ------------------------------
// Action Handlers
// ------------------------------

function onFetchEndpointsHistory(state, { payload }) {
    return {
        ...initialState,
        query: payload,
        fetching: true
    };
}

function onCompleteFetchEndpointsHistory(state, { payload }) {
    if (payload.query !== state.query) {
        return state;
    }

    return {
        ...state,
        fetching: false,
        error: false,
        samples: payload.history.map(record => ({
            timestamp: record.timestamp,
            endpointCount: record.endpoint_count,
            cpuCount: record.cpu_count,
            cpuUsage: record.cpu_usage,
            memoryUsage: record.memory_usage,
            readSize: record.read_bytes,
            writeSize: record.write_bytes
        }))
    };
}

function onFailFetchEndpointsHistory(state, { payload }) {
    if (payload.query !== state.query) {
        return state;
    }

    return {
        ...state,
        error: true
    };
}

function onDropEndpointsHistory() {
    return initialState;
}

// ------------------------------
// Local util functions
// ------------------------------

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [FETCH_ENDPOINTS_HISTORY]: onFetchEndpointsHistory,
    [COMPLETE_FETCH_ENDPOINTS_HISTORY]: onCompleteFetchEndpointsHistory,
    [FAIL_FETCH_ENDPOINTS_HISTORY]: onFailFetchEndpointsHistory,
    [DROP_ENDPOINTS_HISTORY]: onDropEndpointsHistory
});
