/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
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
    const { total_chunks, chunks, objects } = response;
    if (!_queryMatching(query, state)) return state;

    const parts = chunks.map(chunk => {
        const part = chunk.parts[0];
        const obj = objects.find(it => it.obj_id === part.obj_id);
        const mode =
            ((chunk.is_building_blocks || chunk.is_building_frags) && 'BUILDING') ||
            (chunk.is_accessible ? 'AVAILABLE' : 'UNAVAILABLE');
        return {
            mode,
            bucket: obj.bucket,
            object: obj.key,
            version: obj.version_id || 'null',
            start: part.start,
            end: part.end
        };
    });

    return {
        ...state,
        parts,
        partCount: total_chunks,
        fetching: false,
        error: false
    };
}

function onFailFetchHostObjects(state, { payload }) {
    if (!_queryMatching(payload.query, state)) return state;

    return {
        ...state,
        fetching: false,
        error: true
    };
}

function onFetchCloudResourceObjects(state, { payload }) {
    return onFetchHostObjects(
        state, { payload: _resourceQueryToHostQuery(payload) }
    );
}

function onCompleteFetchCloudResourceObjects(state, { payload }) {
    return onCompleteFetchHostObjects(
        state, {
            payload: {
                query: _resourceQueryToHostQuery(payload.query),
                response: payload.response
            }
        }
    );
}

function onFailCloudResourceObjects(state, { payload }) {
    return onFailFetchHostObjects(
        state, {
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
