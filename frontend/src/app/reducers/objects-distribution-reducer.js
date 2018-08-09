/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { keyByProperty } from 'utils/core-utils';
import {
    FETCH_OBJECTS_DISTRIBUTION,
    COMPLETE_FETCH_OBJECTS_DISTRIBUTION,
    FAIL_FETCH_OBJECTS_DISTRIBUTION,
    DROP_FETCH_OBJECTS_DISTRIBUTION
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
function onFetchObjectsDistribution() {
    return {
        ...initialState,
        fetching: true
    };
}

function onCompleteFetchObjectsDistribution(state, { payload }) {
    return {
        fetching: false,
        buckets: keyByProperty(
            payload,
            'name',
            record => record.bins.map(bin => ({
                size: bin.sum,
                count: bin.count
            }))
        )
    };
}

function onFailFetchObjectsDistribution(state) {
    return {
        ...state,
        fetching: false,
        error: true
    };
}

function onDropFetchObjectsDistribution() {
    return initialState;
}

// ------------------------------
// Local util functions
// ------------------------------

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [FETCH_OBJECTS_DISTRIBUTION]: onFetchObjectsDistribution,
    [COMPLETE_FETCH_OBJECTS_DISTRIBUTION]: onCompleteFetchObjectsDistribution,
    [FAIL_FETCH_OBJECTS_DISTRIBUTION]: onFailFetchObjectsDistribution,
    [DROP_FETCH_OBJECTS_DISTRIBUTION]: onDropFetchObjectsDistribution
});
