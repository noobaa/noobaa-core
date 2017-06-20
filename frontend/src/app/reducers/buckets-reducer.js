/* Copyright (C) 2016 NooBaa */

import { keyByProperty } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import { COMPLETE_FETCH_SYSTEM_INFO, COMPLETE_UPDATE_BUCKET_INTERNAL_SPILLOVER } from 'action-types';


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
        spilloverEnabled: bucket.spillover_enabled,
        mode: _clacBucketMode(bucket),
        storage: bucket.storage,
        data: bucket.data,
        quota: bucket.quota,
        usage_by_pool: keyByProperty(
            bucket.usage_by_pool.pools,
            'pool_name',
            ({ pool_name, storage }) => ({
                name: pool_name,
                storage
            })
        )
    }));
}

function onCompleteUpdateBucketInternalSpillover(state, { payload }) {
    const { bucket, spilloverEnabled } = payload;

    return { ...state, [bucket]: { ...state[bucket], spilloverEnabled }  };
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
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo,
    [COMPLETE_UPDATE_BUCKET_INTERNAL_SPILLOVER]: onCompleteUpdateBucketInternalSpillover
});
