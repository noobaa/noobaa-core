/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { RESTORE_LAST_SESSION, SIGN_IN, SIGN_OUT } from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = null;

// ------------------------------
// Action Handlers
// ------------------------------
function onRestoreLastSession(_, { payload }) {
    return _getUserSession(payload);
}

function onSignIn(_, { payload }) {
    return _getUserSession(payload);
}

function onSignOut() {
    return initialState;
}

// ------------------------------
// Local util functions
// ------------------------------
function _getUserSession({ account, system, role }) {
    return {
        user: account.email,
        system: system.name,
        role: role,
        passwordExpired: Boolean(account.must_change_password),
    };
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [RESTORE_LAST_SESSION]: onRestoreLastSession,
    [SIGN_IN]: onSignIn,
    [SIGN_OUT]: onSignOut
});
