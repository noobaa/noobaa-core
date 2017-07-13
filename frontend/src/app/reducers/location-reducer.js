/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { CHANGE_LOCATION } from 'action-types';

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

// ------------------------------
// Local util functions
// ------------------------------

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [CHANGE_LOCATION]: onChangeLocation
});
