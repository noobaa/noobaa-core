/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import {
    COMPLETE_CREATE_SYSTEM,
    COMPLETE_RESTORE_SESSION,
    COMPLETE_SIGN_IN,
    SIGN_OUT
} from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = null;

// ------------------------------
// Action Handlers
// ------------------------------
function onCompleteCreateSystem(_, { payload }) {
    return payload;
}

function onCompleteRestoreSession(_, { payload }) {
    return payload;
}

function onCompleteSignIn(_, { payload }) {
    return payload;
}

function onSignOut() {
    return initialState;
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_CREATE_SYSTEM]: onCompleteCreateSystem,
    [COMPLETE_RESTORE_SESSION]: onCompleteRestoreSession,
    [COMPLETE_SIGN_IN]: onCompleteSignIn,
    [SIGN_OUT]: onSignOut
});
