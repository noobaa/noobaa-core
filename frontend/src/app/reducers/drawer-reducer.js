/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import {
    OPEN_DRAWER,
    CLOSE_DRAWER,
    CHANGE_LOCATION
} from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = undefined;

// ------------------------------
// Action Handlers
// ------------------------------

function onOpenDrawer(_, { payload }) {
    return payload.pane;
}

function onCloseDrawer() {
    return initialState;
}

function onChangeLocation() {
    return initialState;
}

// ------------------------------
// Exported reducer function.
// ------------------------------

export default createReducer(initialState, {
    [OPEN_DRAWER]: onOpenDrawer,
    [CLOSE_DRAWER]: onCloseDrawer,
    [CHANGE_LOCATION]: onChangeLocation
});
