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
    return keyByProperty(payload.buckets, 'name', bucket => {
        const { name, storage } = bucket;
        const mode = _clacBucketMode(bucket);
        return { name, mode, storage };
    });
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
