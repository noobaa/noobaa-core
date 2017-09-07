/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { COMPLETE_FETCH_SYSTEM_INFO } from 'action-types';
import { keyByProperty } from 'utils/core-utils';

// ------------------------------
// Initial State
// ------------------------------
const initialState = undefined;

// ------------------------------
// Action Handlers
// ------------------------------
function onCompleteFetchSystemInfo(_ , { payload }) {
    return keyByProperty(
        payload.pools.filter(pool => pool.resource_type === 'INTERNAL'),
        'name',
        _mapInternalResource,
    );
}

// ------------------------------
// Local util functions
// ------------------------------
function _mapInternalResource(resource) {
    return {
        name: resource.name,
        mode: resource.mode,
        storage: resource.storage
    };
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
