/* Copyright (C) 2016 NooBaa */

import { keyByProperty } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import { COMPLETE_FETCH_SYSTEM_INFO } from 'action-types';
// import { groupBy } from 'utils/core-utils';


// ------------------------------
// Initial State
// ------------------------------
const initialState = undefined;

// ------------------------------
// Action Handlers
// ------------------------------
function onCompleteFetchSystemInfo(state, { payload }) {
    const dataBuckets = payload.buckets
        .filter(bucket => bucket.bucket_type === 'REGULAR');

    return keyByProperty(dataBuckets, 'name', _mapBucket);
}

// ------------------------------
// Local util functions
// ------------------------------
function _mapBucket(bucket,) {
    return {
        name: bucket.name,
        mode: bucket.mode,
        storage: bucket.storage.values,
        data: bucket.data,
        quota: bucket.quota,
    };
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
