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

export function restoreSession(token) {
    return {
        type: RESTORE_SESSION,
        payload: { token }
    };
}

export function completeRestoreSession(token, sessionInfo) {
    const { account, system } = sessionInfo;
    return {
        type: COMPLETE_RESTORE_SESSION,
        payload: {
            token: token,
            user: account.email,
            system: system.name,
            passwordExpaired: Boolean(account.must_change_password),
            persistent: true
        }
    };
}

export function failResotreSession(token, error) {
    return {
        type: FAIL_RESTORE_SESSION,
        payload: { token, error }
    };
}

export function signIn(email, password, keepSessionAlive = false) {
    return {
        type: SIGN_IN,
        payload: { email, password, keepSessionAlive }
    };
}

export function completeSignIn(token, sessionInfo) {
    const { account, system } = sessionInfo;
    return {
        type: COMPLETE_SIGN_IN,
        payload: {
            token: token,
            user: account.email,
            system: system.name,
            passwordExpaired: Boolean(account.must_change_password),
            persistent: true
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
