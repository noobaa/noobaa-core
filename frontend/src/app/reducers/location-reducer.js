/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { CHANGE_LOCATION } from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = null;

// ------------------------------
// Action Handlers
// ------------------------------
function onChangeLocation(location, { location: newLocation }) {
    return { ...location, ...newLocation };
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
