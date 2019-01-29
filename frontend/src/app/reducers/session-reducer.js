/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import {
    COMPLETE_CREATE_SYSTEM,
    COMPLETE_RESTORE_SESSION,
    FAIL_RESTORE_SESSION,
    COMPLETE_SIGN_IN,
    SIGN_OUT,
    UPDATE_ACCOUNT_UI_THEME
} from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = undefined;

// ------------------------------
// Action Handlers
// ------------------------------
function onCompleteCreateSystem(_, { payload }) {
    return payload;
}

function onCompleteRestoreSession(_, { payload }) {
    return payload;
}

function onFailRestoreSession() {
    return null;
}

function onCompleteSignIn(_, { payload }) {
    return payload;
}

function onSignOut() {
    return null;
}

function onUpdateAccountUITheme(state, { payload }) {
    const { accountName, theme } = payload;
    if (accountName !== state.user) {
        return state;
    }

    return {
        ...state,
        uiTheme: theme.toLowerCase()
    };
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_CREATE_SYSTEM]: onCompleteCreateSystem,
    [COMPLETE_RESTORE_SESSION]: onCompleteRestoreSession,
    [FAIL_RESTORE_SESSION]: onFailRestoreSession,
    [COMPLETE_SIGN_IN]: onCompleteSignIn,
    [SIGN_OUT]: onSignOut,
    [UPDATE_ACCOUNT_UI_THEME]: onUpdateAccountUITheme
});
