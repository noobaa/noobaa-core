/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import {
    CHANGE_LOCATION,
    REFRESH_LOCATION
} from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = undefined;

// ------------------------------
// Action Handlers
// ------------------------------
function onChangeLocation(location, { payload }) {
    return {
        ...payload,
        refreshCount: 0

    };
}

function onRefreshLocation(location) {
    return {
        ...location,
        refreshCount: location.refreshCount + 1
    };
}

// ------------------------------
// Local util functions
// ------------------------------

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [CHANGE_LOCATION]: onChangeLocation,
    [REFRESH_LOCATION]: onRefreshLocation
});
