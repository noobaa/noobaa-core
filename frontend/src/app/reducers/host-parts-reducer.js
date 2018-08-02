/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { flatMap } from 'utils/core-utils';
import {
    FETCH_HOST_OBJECTS,
    COMPLETE_FETCH_HOST_OBJECTS,
    FAIL_FETCH_HOST_OBJECTS,
    FETCH_CLOUD_RESOURCE_OBJECTS,
    COMPLETE_FETCH_CLOUD_RESOURCE_OBJECTS,
    FAIL_FETCH_CLOUD_RESOURCE_OBJECTS
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
            bucket: obj.bucket,
            object: obj.key,
            version: obj.version_id,
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
        error: true
    };
}

function onFetchCloudResourceObjects(state, { payload }) {
    return onFetchHostObjects(
        state,
        { payload: _resourceQueryToHostQuery(payload) }
    );
}

function onCompleteFetchCloudResourceObjects(state, { payload }) {
    return onCompleteFetchHostObjects(
        state,
        {
            payload: {
                query: _resourceQueryToHostQuery(payload.query),
                response: payload.response
            }
        }
    );
}

function onFailCloudResourceObjects(state, { payload }) {
    return onFailFetchHostObjects(
        state,
        {
            payload: {
                query: _resourceQueryToHostQuery(payload.query),
                error: payload.error
            }
        }
    );
}

// ------------------------------
// Local util functions
// ------------------------------
function _queryMatching(query, state) {
    return (
        query.host === state.host &&
        query.skip === state.skip &&
        query.limit === state.limit
    );
}

function _resourceQueryToHostQuery(query) {
    const { resource: _, ...rest } = query;
    return { ...rest, host: `${query.resource}#internal-host` };
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [FETCH_HOST_OBJECTS]: onFetchHostObjects,
    [COMPLETE_FETCH_HOST_OBJECTS]: onCompleteFetchHostObjects,
    [FAIL_FETCH_HOST_OBJECTS]: onFailFetchHostObjects,
    [FETCH_CLOUD_RESOURCE_OBJECTS]: onFetchCloudResourceObjects,
    [COMPLETE_FETCH_CLOUD_RESOURCE_OBJECTS]: onCompleteFetchCloudResourceObjects,
    [FAIL_FETCH_CLOUD_RESOURCE_OBJECTS]: onFailCloudResourceObjects
});
