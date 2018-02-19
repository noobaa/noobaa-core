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
    COMPLETE_DELETE_OBJECT,
    DROP_OBJECTS_VIEW
} from 'action-types';

const inMemoryQueryLimit = 10;
const inMemoryHostLimit = paginationPageSize * inMemoryQueryLimit;

// ------------------------------
// Action Handlers
// ------------------------------

function onFetchObjects(state, { payload }) {
    const { view, query, timestamp } = payload;
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
    const { response } = payload;
    const items = keyBy(
        response.objects,
        obj => getObjectId(obj.bucket, obj.key, _getUploadId(obj)),
        _mapObject
    );

    const counters = {
        optimal: response.counters.by_mode.completed,
        uploading: response.counters.by_mode.uploading
    };

    return handleFetchCompleted(
        state,
        payload.query,
        items,
        { counters },
        inMemoryQueryLimit,
        inMemoryHostLimit
    );
}

function onFailFetchObjects(state, { payload }) {
    return handleFetchFailed(state, payload.query);
}

function onCompleteDeleteObject(state, { payload }) {
    const { bucket, key, uploadId } = payload;
    return handleRemoveItem(
        state,
        getObjectId(bucket, key, uploadId),
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

function _mapObject(obj) {
    const mode = obj.upload_started ? 'UPLOADING' : 'OPTIMAL';
    const uploadId = _getUploadId(obj);
    const { reads = 0, last_read } = obj.stats || {};

    return {
        bucket: obj.bucket,
        key: obj.key,
        uploadId: uploadId,
        mode: mode,
        size: {
            original: obj.size,
            onDisk: obj.capacity_size
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
    [COMPLETE_DELETE_OBJECT]: onCompleteDeleteObject,
    [DROP_OBJECTS_VIEW]: onDropObjectsView
});
