/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import {
    FETCH_LAMBDA_FUNC_USAGE_HISTORY,
    COMPLETE_FETCH_LAMBDA_FUNC_USAGE_HISTORY,
    FAIL_FETCH_LAMBDA_FUNC_USAGE_HISTORY,
    DROP_LAMBDA_FUNC_USAGE_HISTORY
} from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {
    query: undefined,
    data: undefined,
    fetching: false,
    error: false
};

// ------------------------------
// Action Handlers
// ------------------------------

function onFetchLambdaFuncUsageHistory(state, { payload }) {
    return {
        ...initialState,
        query: payload,
        fetching: true
    };
}

function onCompleteFetchLambdaFuncUsageHistory(state, { payload }) {
    if (payload.query !== state.query) {
        return state;
    }

    return {
        ...state,
        fetching: false,
        error: false,
        data: {
            stats: _mapUsageStats(payload.usage.stats),
            slices: payload.usage.slices.map(_mapUsageStats)
        }
    };
}

function onFailFetchLambdaFuncUsageHistory(state, { payload }) {
    if (payload.query !== state.query) {
        return state;
    }

    return {
        ...state,
        error: true
    };
}

function onDropLambdaFuncUsageHistory() {
    return initialState;
}

// ------------------------------
// Local util functions
// ------------------------------
function _mapUsageStats(sample) {
    return {
        since: sample.since,
        till: sample.till,
        invoked: sample.invoked,
        fulfilled: sample.fulfilled,
        rejected: sample.rejected,
        aggrResponseTime: sample.aggr_response_time,
        maxResponseTime: sample.max_response_time,
        avgResponseTime: sample.avg_response_time,
        responsePercentiles: sample.response_percentiles
    };
}


// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [FETCH_LAMBDA_FUNC_USAGE_HISTORY]: onFetchLambdaFuncUsageHistory,
    [COMPLETE_FETCH_LAMBDA_FUNC_USAGE_HISTORY]: onCompleteFetchLambdaFuncUsageHistory,
    [FAIL_FETCH_LAMBDA_FUNC_USAGE_HISTORY]: onFailFetchLambdaFuncUsageHistory,
    [DROP_LAMBDA_FUNC_USAGE_HISTORY]: onDropLambdaFuncUsageHistory
});
