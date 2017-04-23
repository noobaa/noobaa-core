/* Copyright (C) 2016 NooBaa */

import { keyByProperty } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {};

// ------------------------------
// Action Handlers
// ------------------------------
function onApplicationInit() {
    return initialState;
}

function onSystemInfoFetched(state, { info }) {
    return keyByProperty(info.buckets, 'name', bucket => {
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
export default createReducer({
    APPLICATION_INIT: onApplicationInit,
    SYSTEM_INFO_FETCHED: onSystemInfoFetched
});
