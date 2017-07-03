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
    return keyByProperty(
        [],
        'name',
        resource => ({
            name: resource.name,
            type: resource.cloud_info.endpoint_type,
            mode: 'OPTIMAL',
            target: resource.cloud_info.target_bucket,
            storage: resource.storage,
            objectCount: resource.object_count
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
