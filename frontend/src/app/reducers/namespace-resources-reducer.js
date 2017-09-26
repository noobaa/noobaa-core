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
    const resources = payload.namespace_resources;
    return keyByProperty(resources, 'name', _mapResource);
}

// ------------------------------
// Local util functions
// ------------------------------
function _mapResource(resource) {
    return {
        mode: 'OPTIMAL',
        name: resource.name,
        service: resource.endpoint_type,
        target: resource.target_bucket,
        undeletable: resource.undeletable
    };
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
