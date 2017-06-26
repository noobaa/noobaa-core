/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import {
    COMPLETE_CREATE_SYSTEM,
    COMPLETE_RESTORE_SESSION,
    COMPLETE_SIGN_IN,
    SIGN_OUT,
    COMPLETE_CHANGE_ACCOUNT_PASSWORD
} from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = undefined;

// ------------------------------
// Action Handlers
// ------------------------------
function onCompleteCreateSystem(_, { payload }) {
    return payload || undefined;
}

function onCompleteRestoreSession(_, { payload }) {
    return payload || undefined;
}

function onCompleteSignIn(_, { payload }) {
    return payload || undefined;
}

function onSignOut() {
    return initialState;
}

function onCompleteChangeAccountPassword(session, { payload }) {
    const { accountName, expireNewPassword } = payload;
    if (session.user !== accountName) {
        return session;
    }

    return {
        ...session,
        passwordExpired: expireNewPassword
    };
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_CREATE_SYSTEM]: onCompleteCreateSystem,
    [COMPLETE_RESTORE_SESSION]: onCompleteRestoreSession,
    [COMPLETE_SIGN_IN]: onCompleteSignIn,
    [SIGN_OUT]: onSignOut,
    [COMPLETE_CHANGE_ACCOUNT_PASSWORD]: onCompleteChangeAccountPassword
});
