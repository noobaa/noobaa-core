/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {
    name: 'login'
};

// ------------------------------
// Action Handlers
// ------------------------------
function onInitApplication() {
    return initialState;
}

// ------------------------------
// Local util functions
// ------------------------------

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer({
    INIT_APPLICATION: onInitApplication
});
