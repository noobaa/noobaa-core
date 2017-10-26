/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { keyByProperty } from 'utils/core-utils';
import { COMPLETE_FETCH_BUCKET_OBJECTS } from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = null;

// ------------------------------
// Action Handlers
// ------------------------------

// An example of an action handler
function onCompleteFetchBucketObjects(_, { payload }) {
    const { objects, counters } = payload.response;

    return {
        counters: {
            nonPaginated: counters.non_paginated,
            completed: counters.by_mode.completed,
            uploading: counters.by_mode.uploading,
        },
        objects: keyByProperty(
            objects,
            'key',
            object => _bucketObjectMapping(object)
        )
    };
}

// ------------------------------
// Local util functions
// ------------------------------
function _bucketObjectMapping(object) {
    return {
        objId: object.obj_id,
        bucket: object.bucket,
        key: object.key,
        size: object.size,
        contentType: object.content_type,
        createTime: object.create_time
    };
}


// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_BUCKET_OBJECTS]: onCompleteFetchBucketObjects
});
