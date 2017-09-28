/* Copyright (C) 2016 NooBaa */

import { keyByProperty } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import { COMPLETE_FETCH_SYSTEM_INFO } from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = undefined;

// ------------------------------
// Action Handlers
// ------------------------------
function onCompleteFetchSystemInfo(_ , { payload }) {
    const gatewayBuckets = payload.buckets
        .filter(bucket => bucket.bucket_type === 'NAMESPACE');

    return keyByProperty(gatewayBuckets, 'name', _mapBucket);
}

// ------------------------------
// Local util functions
// ------------------------------
function _mapBucket(bucket) {
    return {
        name: bucket.name,
        mode: bucket.mode,
        placement: _mapPlacement(bucket.namespace),
        io: _mapIO(bucket.stats)
    };
}

function _mapPlacement(namespace){
    return {
        readFrom: namespace.read_resources,
        writeTo: namespace.write_resource
    };
}

function _mapIO(stats = {}) {
    const { reads = 0, writes = 0, last_read = -1, last_write = -1 } = stats;
    return {
        readCount: reads ,
        lastRead: last_read,
        writeCount: writes,
        lastWrite: last_write
    };
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
