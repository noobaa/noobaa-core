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
function onCompleteFetchSystemInfo(/*/_ , { payload }*/) {
    const mockBuckets = [];

    return keyByProperty(
        mockBuckets,
        'name',
        bucket => ({
            name: bucket.name,
            mode: 'OPTIMAL',
            storage: bucket.storage,
            objectCount: bucket.num_obsjects,
            readPolicy: bucket.backing_buckets || [],
            writePolicy: (bucket.backing_buckets || [])[0],
            lastRead: bucket.stats.last_read,
            lastWrite: bucket.stats.last_write
        })
    );
}

// ------------------------------
// Local util functions
// ------------------------------

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
