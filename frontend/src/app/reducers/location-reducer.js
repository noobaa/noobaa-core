/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { deepClone } from 'utils/core-utils';
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
    return payload;
}

function onRefreshLocation(location) {
    return deepClone(location);
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
