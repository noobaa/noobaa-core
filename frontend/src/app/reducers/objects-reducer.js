/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { paginationPageSize } from 'config';
import { keyBy } from 'utils/core-utils';
import { getObjectId } from 'utils/object-utils';
import {
    initialState,
    handleFetch,
    handleFetchCompleted,
    handleFetchFailed,
    handleDropView,
    handleRemoveItem
} from 'utils/item-cache-utils';
import {
    FETCH_OBJECTS,
    COMPLETE_FETCH_OBJECTS,
    FAIL_FETCH_OBJECTS,
    FETCH_OBJECT,
    COMPLETE_FETCH_OBJECT,
    FAIL_FETCH_OBJECT,
    COMPLETE_DELETE_OBJECT,
    DROP_OBJECTS_VIEW
} from 'action-types';

const inMemoryQueryLimit = 10;
const inMemoryHostLimit = paginationPageSize * inMemoryQueryLimit;

// ------------------------------
// Action Handlers
// ------------------------------

function onFetchObjects(state, { payload, timestamp }) {
    const { view, query } = payload;

    return handleFetch(
        state,
        query,
        view,
        timestamp,
        inMemoryQueryLimit,
        inMemoryHostLimit
    );
}

function onCompleteFetchObjects(state, { payload }) {
    const { query, response } = payload;
    return _onCompleteFetch(state, query, response);
}

function onFailFetchObjects(state, { payload }) {
    return handleFetchFailed(state, payload.query);
}

function onFetchObject(state, { payload, timestamp }) {
    const { view, bucket, object } = payload;
    return handleFetch(
        state,
        { bucket, object },
        view,
        timestamp,
        inMemoryQueryLimit,
        inMemoryHostLimit
    );
}

function onCompleteFetchObject(state, { payload }) {
    const { bucket, object, response } = payload;
    return _onCompleteFetch(state, { bucket, object }, response);
}

function onFailFetchObject(state, { payload }) {
    const { bucket, object } = payload;
    return handleFetchFailed(state, { bucket, object });
}

function onCompleteDeleteObject(state, { payload }) {
    const { bucket, key, versionId, uploadId } = payload;
    return handleRemoveItem(
        state,
        getObjectId(bucket, key, versionId, uploadId),
        (extras, obj) => {
            const counterName = obj.mode.toLowerCase();
            const updatedCounter = extras.counters[counterName] - 1;
            const counters = {
                ...extras.counters,
                [counterName]: updatedCounter
            };
            return { counters };
        }
    );
}

function onDropObjectsView(state, { payload }) {
    return handleDropView(state, payload.view);
}

// ------------------------------
// Local util functions
// ------------------------------

function _onCompleteFetch(state, query, response) {
    const items = keyBy(
        response.objects,
        obj => getObjectId(obj.bucket, obj.key, obj.version_id || 'null', _getUploadId(obj)),
        (obj, objId) => _mapObject(obj, state.items[objId])
    );

    const emptyReason = items.length > 0 ? undefined : response.empty_reason;
    const counters = {
        optimal: response.counters.by_mode.completed,
        uploading: response.counters.by_mode.uploading
    };

    return handleFetchCompleted(
        state,
        query,
        items,
        { counters, emptyReason },
        inMemoryQueryLimit,
        inMemoryHostLimit
    );
}

function _mapObject(obj, lastState) {
    const mode = obj.upload_started ? 'UPLOADING' : 'OPTIMAL';
    const uploadId = _getUploadId(obj);
    const { reads = 0, last_read } = obj.stats || {};

    return {
        bucket: obj.bucket,
        key: obj.key,
        versionId: obj.version_id || 'null',
        uploadId: uploadId,
        latestVersion: Boolean(obj.is_latest),
        deleteMarker: Boolean(obj.delete_marker),
        mode: mode,
        size: {
            original: obj.size,
            onDisk: lastState && lastState.size.onDisk || obj.capacity_size
        },
        contentType: obj.content_type,
        createTime: obj.create_time,
        lastReadTime: last_read,
        readCount: reads,
        partCount: obj.num_parts,
        s3SignedUrl: obj.s3_signed_url
    };
}

function _getUploadId(obj) {
    return obj.upload_started ? obj.obj_id : undefined;
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [FETCH_OBJECTS]: onFetchObjects,
    [COMPLETE_FETCH_OBJECTS]: onCompleteFetchObjects,
    [FAIL_FETCH_OBJECTS]: onFailFetchObjects,
    [FETCH_OBJECT]: onFetchObject,
    [COMPLETE_FETCH_OBJECT]: onCompleteFetchObject,
    [FAIL_FETCH_OBJECT]: onFailFetchObject,
    [COMPLETE_DELETE_OBJECT]: onCompleteDeleteObject,
    [DROP_OBJECTS_VIEW]: onDropObjectsView
});
