/* Copyright (C) 2016 NooBaa */

import { keyBy, keyByProperty, flatMap, groupBy } from 'utils/core-utils';
import { COMPLETE_FETCH_SYSTEM_INFO } from 'action-types';
import { createReducer } from 'utils/reducer-utils';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {};

// ------------------------------
// Action Handlers
// ------------------------------

function onCompleteFetchSystemInfo(_, { payload }) {
    const { pools, buckets } = payload;

    const enabledInBuckets = buckets.filter(bucket => bucket.spillover_enabled);

    return keyByProperty(
        pools.filter(pool => pool.resource_type === 'INTERNAL'),
        'name',
        ({ name, storage }) => ({
            name,
            state: enabledInBuckets.length ? 'ENABLED' : 'DISABLED',
            storage: storage,
            usedBy: enabledInBuckets
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
