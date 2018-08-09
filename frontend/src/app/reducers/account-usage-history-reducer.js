/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import {
    FETCH_ACCOUNT_USAGE_HISTORY,
    COMPLETE_FETCH_ACCOUNT_USAGE_HISTORY,
    FAIL_FETCH_ACCOUNT_USAGE_HISTORY,
    DROP_ACCOUNT_USAGE_HISTORY
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

function onFetchAccountUsageHistory(state, { payload }) {
    return {
        ...initialState,
        query: payload,
        fetching: true
    };
}

function onCompleteFetchAccountUsageHistory(state, { payload }) {
    if (payload.query !== state.query) {
        return state;
    }

    return {
        ...state,
        fetching: false,
        error: false,
        samples: payload.usage.map(sample => ({
            account: sample.account,
            readSize: sample.read_bytes,
            writeSize: sample.write_bytes
        }))
    };
}

function onFailFetchAccountUsageHistory(state, { payload }) {
    if (payload.query !== state.query) {
        return state;
    }

    return {
        ...state,
        error: true
    };
}

function onDropAccountUsageHistory() {
    return initialState;
}

// ------------------------------
// Local util functions
// ------------------------------

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [FETCH_ACCOUNT_USAGE_HISTORY]: onFetchAccountUsageHistory,
    [COMPLETE_FETCH_ACCOUNT_USAGE_HISTORY]: onCompleteFetchAccountUsageHistory,
    [FAIL_FETCH_ACCOUNT_USAGE_HISTORY]: onFailFetchAccountUsageHistory,
    [DROP_ACCOUNT_USAGE_HISTORY]: onDropAccountUsageHistory
});
