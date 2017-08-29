/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { flatMap } from 'utils/core-utils';
import {
    FETCH_HOST_OBJECTS,
    COMPLETE_FETCH_HOST_OBJECTS,
    FAIL_FETCH_HOST_OBJECTS,
 } from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {
    host: '',
    parts: undefined,
    partCount: 0,
    fetching: false,
    error: false
};

// ------------------------------
// Action Handlers
// ------------------------------

function onFetchHostObjects(state, { payload }) {
    const parts = _queryMatching(payload, state) ? state.parts : undefined;
    const { host, skip, limit } = payload;

    return {
        ...state,
        host: host,
        skip: skip,
        limit: limit,
        parts: parts,
        fetching: true,
        error: false
    };
}

function onCompleteFetchHostObjects(state, { payload }) {
    const { query, response } = payload;
    if (!_queryMatching(query, state))  return state;

    const parts = flatMap(response.objects, obj => {
        return obj.parts.map(part => ({
            mode: part.chunk.adminfo.health.toUpperCase(),
            object: obj.key,
            bucket: obj.bucket,
            start: part.start,
            end: part.end
        }));
    });

    return {
        ...state,
        parts,
        partCount: response.total_count,
        fetching: false,
        error: false
    };
}

function onFailFetchHostObjects(state, { payload }) {
    if (!_queryMatching(payload.query, state))  return state;

    return {
        ...state,
        fetching: false,
        errors: true
    };
}

// ------------------------------
// Local util functions
// ------------------------------
function _queryMatching(query, state) {
    return query.host === state.host &&
        query.skip === state.skip &&
        query.limit === state.limit;
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [FETCH_HOST_OBJECTS]: onFetchHostObjects,
    [COMPLETE_FETCH_HOST_OBJECTS]: onCompleteFetchHostObjects,
    [FAIL_FETCH_HOST_OBJECTS]: onFailFetchHostObjects
});
