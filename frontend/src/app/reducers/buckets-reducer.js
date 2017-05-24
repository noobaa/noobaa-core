/* Copyright (C) 2016 NooBaa */

import { keyByProperty } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import { COMPLETE_FETCH_SYSTEM_INFO } from 'action-types';


// ------------------------------
// Initial State
// ------------------------------
const initialState = {};

// ------------------------------
// Action Handlers
// ------------------------------
function onCompleteFetchSystemInfo(state, { payload }) {
    return keyByProperty(payload.buckets, 'name', bucket => ({
        name: bucket.name,
        mode: _clacBucketMode(bucket),
        storage: bucket.storage,
        data: bucket.data,
        quota: bucket.quota
    }));
}

// ------------------------------
// Local util functions
// ------------------------------
function _clacBucketMode({ writable }) {
    return writable = writable ? 'OPTIMAL' : 'NOT_WRITABLE';
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
