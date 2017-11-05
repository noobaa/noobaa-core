/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import {
    hashCode,
    createCompareFunc,
    flatMap,
    keyBy,
    mapValues
} from 'utils/core-utils';
import {
    FETCH_BUCKET_OBJECTS,
    COMPLETE_FETCH_BUCKET_OBJECTS,
    FAIL_FETCH_BUCKET_OBJECTS,
    COMPLETE_DELETE_BUCKET_OBJECT
} from 'action-types';

const inMemoryQueryLimit = 3;

// ------------------------------
// Initial State
// ------------------------------
const initialState = {
    queries: {},
    items: {}
};

// ------------------------------
// Action Handlers
// ------------------------------
function onFetchBucketObjects(state, { payload }) {
    const { query, timestamp } = payload;
    const queryKey = _generateQueryKey(query);
    const newState = {
        ...state,
        queries: {
            ...state.queries,
            [queryKey]: {
                ...(state.queries[queryKey] || {}),
                selector: query,
                fetching: true,
                error: false,
                timestamp
            }
        }
    };

    return _clearOverallocated(
        newState,
        inMemoryQueryLimit
    );
}

function onCompleteFetchBucketObjects(state, { payload }) {
    const { objects, counters } = payload.response;
    const queryKey = _generateQueryKey(payload.query);
    const query = state.queries[queryKey];
    const mappedObjects = objects.map(_mapObject);
    const queries = {
        ...state.queries,
        [queryKey]: {
            ...query,
            fetching: false,
            result: {
                objects: mappedObjects.map(_getObjectId),
                counters: {
                    optimal: counters.by_mode.completed,
                    uploading: counters.by_mode.uploading
                }
            }
        }
    };

    return {
        ...state,
        queries,
        items: {
            ...state.items,
            ...keyBy(
                mappedObjects,
                _getObjectId
            )
        }
    };
}

function onFailFetchBucketObjects(state, { payload }) {
    const { query } = payload;
    const queryKey = _generateQueryKey(query);

    return {
        ...state,
        queries: {
            ...state.queries,
            [queryKey]: {
                ...state.queries[queryKey],
                fetching: false,
                error: true
            }
        }
    };
}

function onCompleteDeleteBucketObject(state, { payload }) {
    const objKey = _getObjectId(payload);
    const { [objKey]: deleteObject, ...items } = state.items;

    const queries = mapValues(
        state.queries,
        query => ({
            ...query,
            result: _removeObjectFromResult(query.result, objKey, deleteObject.mode)
        })
    );

    return {
        ...state,
        queries,
        items
    };
}

// ------------------------------
// Local util functions
// ------------------------------
function _generateQueryKey(query) {
    return hashCode(query);
}

function _getObjectId({ bucket, key, uploadId }) {
    return uploadId ? `${bucket}:${key}:${uploadId}` : `${bucket}:${key}`;
}

function _mapObject(obj) {
    const {
        obj_id,
        bucket,
        key,
        size,
        create_time: createTime,
        upload_started
    } = obj;

    const mode = upload_started ? 'UPLOADING' : 'OPTIMAL';
    const uploadId = mode === 'UPLOADING' ? obj_id : undefined;

    return { bucket, key, size, createTime, mode, uploadId};
}

function _clearOverallocated(state, queryLimit) {
    const list = Object.values(state.queries);
    let overallocatedCount = Math.max(0, list.length - queryLimit);
    if (overallocatedCount <= 0) return state;

    const compareOp = createCompareFunc(
        query => query.timestamp, 1
    );

    const queryList = list
        .sort(compareOp)
        .slice(overallocatedCount);

    const items = {};
    new Set(flatMap(queryList, query => query.result ? query.result.objects : []))
        .forEach(id => items[id] = state.items[id]);

    const queries = keyBy(
        queryList,
        query => _generateQueryKey(query.selector)
    );

    return {
        ...state,
        queries,
        items
    };
}

function _removeObjectFromResult(result, objKey, objMode) {
    if (!result) return result;
    const index = result.objects.findIndex(objId => objKey === objId);

    if (index === -1) return result;

    const counterName = objMode.toLowerCase();

    const objects = result.objects
        .filter((_, i) => index !== i);

    const counters = {
        ...result.counters,
        [counterName]: result.counters[counterName] - 1
    };

    return { counters, objects };
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [FETCH_BUCKET_OBJECTS]: onFetchBucketObjects,
    [COMPLETE_FETCH_BUCKET_OBJECTS]: onCompleteFetchBucketObjects,
    [FAIL_FETCH_BUCKET_OBJECTS]: onFailFetchBucketObjects,
    [COMPLETE_DELETE_BUCKET_OBJECT]: onCompleteDeleteBucketObject
});
