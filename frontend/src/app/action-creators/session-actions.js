/* Copyright (C) 2016 NooBaa */

import {
    SIGN_IN,
    COMPLETE_SIGN_IN,
    FAIL_SIGN_IN,
    SIGN_OUT,
    RESTORE_SESSION,
    COMPLETE_RESTORE_SESSION,
    FAIL_RESTORE_SESSION
} from 'action-types';

export function restoreSession() {
    return { type: RESTORE_SESSION };
}

export function completeRestoreSession(
    token,
    sessionInfo,
    persistent = false,
    uiTheme
) {
    const { account, system } = sessionInfo;
    return {
        type: COMPLETE_RESTORE_SESSION,
        payload: {
            token: token,
            user: account.email,
            system: system.name,
            passwordExpired: Boolean(account.must_change_password),
            persistent: persistent,
            uiTheme
        }
    };
}


export function failRestoreSession(token, error) {
    return {
        type: FAIL_RESTORE_SESSION,
        payload: { token, error }
    };
}

export function signIn(email, password, persistent = false) {
    return {
        type: SIGN_IN,
        payload: { email, password, persistent }
    };
}

export function completeSignIn(
    token,
    sessionInfo,
    persistent,
    uiTheme
) {
    const { account, system } = sessionInfo;
    return {
        type: COMPLETE_SIGN_IN,
        payload: {
            token: token,
            user: account.email,
            system: system.name,
            passwordExpired: Boolean(account.must_change_password),
            persistent: persistent,
            uiTheme
        }
    };
}

export function failSignIn(email, error) {
    return {
        type: FAIL_SIGN_IN,
        payload: { error }
    };
}

export function signOut() {
    return { type: SIGN_OUT };
}
