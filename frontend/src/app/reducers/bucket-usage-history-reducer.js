/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import {
    FETCH_BUCKET_USAGE_HISTORY,
    COMPLETE_FETCH_BUCKET_USAGE_HISTORY,
    FAIL_FETCH_BUCKET_USAGE_HISTORY,
    DROP_BUCKET_USAGE_HISTORY

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
function onFetchBucketUsageHistory(state, { payload }) {
    return {
        ...initialState,
        query: payload,
        fetching: true
    };
}

function onCompleteFetchBucketUsageHistory(state, { payload }) {
    if (payload.query !== state.query) {
        return state;
    }

    return {
        ...state,
        fetching: false,
        error: false,
        samples: payload.usage.map(sample => ({
            startTime: sample.start_time,
            endTime: sample.end_time,
            readSize: sample.read_bytes,
            writeSize: sample.write_bytes
        }))
    };
}

function onFailFetchBucketUsageHistory(state, { payload }) {
    if (payload.query !== state.query) {
        return state;
    }

    return {
        ...state,
        fetching: false,
        error: true
    };
}

function onDropBucketUsageHistory() {
    return initialState;
}

// ------------------------------
// Local util functions
// ------------------------------

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [FETCH_BUCKET_USAGE_HISTORY]: onFetchBucketUsageHistory,
    [COMPLETE_FETCH_BUCKET_USAGE_HISTORY]: onCompleteFetchBucketUsageHistory,
    [FAIL_FETCH_BUCKET_USAGE_HISTORY]: onFailFetchBucketUsageHistory,
    [DROP_BUCKET_USAGE_HISTORY]: onDropBucketUsageHistory
});
