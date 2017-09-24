/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import {
    FETCH_CLOUD_TARGETS,
    COMPLETE_FETCH_CLOUD_TARGETS,
    FAIL_FETCH_CLOUD_TARGETS,
    DROP_CLOUD_TARGETS
} from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {
    connection: undefined,
    list: undefined,
    fetching: false,
    error: false
};

// ------------------------------
// Action Handlers
// ------------------------------

// An example of an action handler
function onFetchCloudTargets(state, { payload }) {
    const list = state.connection === payload.connection ? state.list : undefined;
    return {
        connection: payload.connection,
        list: list,
        fetching: true,
        error: false
    };
}

function onCompleteFetchCloudTargets(state, { payload }) {
    if (state.connection !== payload.connection) {
        return state;
    }

    const list = payload.targets
        .map(target => ({
            name: target.name,
            usedBy: _mapTargetUser(target.used_by)
        }));

    return {
        ...state,
        list: list,
        fetching: false
    };
}

function onFailFetchCloudTargets(state, { payload }) {
    if (state.connection !== payload.connection) {
        return state;
    }

    return {
        ...state,
        fetching: false,
        error: true
    };
}

function onDropCloudTargets() {
    return initialState;
}

// ------------------------------
// Local util functions
// ------------------------------
function _mapTargetUser(user) {
    if (!user) return;

    return {
        kind: user.usage_type,
        name: user.name
    };
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [FETCH_CLOUD_TARGETS]: onFetchCloudTargets,
    [COMPLETE_FETCH_CLOUD_TARGETS]: onCompleteFetchCloudTargets,
    [FAIL_FETCH_CLOUD_TARGETS]: onFailFetchCloudTargets,
    [DROP_CLOUD_TARGETS]: onDropCloudTargets
});
