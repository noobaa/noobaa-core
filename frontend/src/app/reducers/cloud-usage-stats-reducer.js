/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { keyByProperty } from 'utils/core-utils';
import {
    FETCH_CLOUD_USAGE_STATS,
    COMPLETE_FETCH_CLOUD_USAGE_STATS,
    FAIL_FETCH_CLOUD_USAGE_STATS,
    DROP_CLOUD_USAGE_STATS
} from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {
    fetching: false,
    error: false
};

// ------------------------------
// Action Handlers
// ------------------------------
function onFetchCloudUsageStats(state, { payload }) {
    return {
        ...initialState,
        query: payload,
        fetching: true
    };
}

function onCompleteFetchCloudUsageStats(state, { payload }) {
    if (payload.query !== state.query) {
        return state;
    }

    return {
        ...state,
        fetching: false,
        error: false,
        usage: keyByProperty(payload.usage, 'service', record => ({
            readCount: record.read_count,
            writeCount: record.write_count,
            readSize: record.read_bytes,
            writeSize: record.write_bytes
        }))
    };
}

function onFailFetchCloudUsageStats(state, { payload }) {
    if (payload.query !== state.query) {
        return state;
    }

    return {
        ...state,
        fetching: false,
        error: true
    };
}

function onDropFetchCloudUsageStats() {
    return initialState;
}

// ------------------------------
// Local util functions
// ------------------------------

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [FETCH_CLOUD_USAGE_STATS]: onFetchCloudUsageStats,
    [COMPLETE_FETCH_CLOUD_USAGE_STATS]: onCompleteFetchCloudUsageStats,
    [FAIL_FETCH_CLOUD_USAGE_STATS]: onFailFetchCloudUsageStats,
    [DROP_CLOUD_USAGE_STATS]: onDropFetchCloudUsageStats
});
