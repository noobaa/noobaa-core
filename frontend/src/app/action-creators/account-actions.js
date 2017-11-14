/* Copyright (C) 2016 NooBaa */

import {
    CREATE_ACCOUNT,
    COMPLETE_CREATE_ACCOUNT,
    FAIL_CREATE_ACCOUNT,
    UPDATE_ACCOUNT_S3_ACCESS,
    COMPLETE_UPDATE_ACCOUNT_S3_ACCESS,
    FAIL_UPDATE_ACCOUNT_S3_ACCESS,
    SET_ACCOUNT_IP_RESTRICTIONS,
    COMPLETE_SET_ACCOUNT_IP_RESTRICTIONS,
    FAIL_SET_ACCOUNT_IP_RESTRICTIONS,
    CHANGE_ACCOUNT_PASSWORD,
    COMPLETE_CHANGE_ACCOUNT_PASSWORD,
    FAIL_CHANGE_ACCOUNT_PASSWORD,
    ADD_EXTERNAL_CONNECTION,
    COMPLETE_ADD_EXTERNAL_CONNECTION,
    FAIL_ADD_EXTERNAL_CONNECTION,
    TRY_DELETE_ACCOUNT,
    COMPLETE_DELETE_ACCOUNT,
    FAIL_DELETE_ACCOUNT,
    DELETE_EXTERNAL_CONNECTION,
    COMPLETE_DELETE_EXTERNAL_CONNECTION,
    FAIL_DELETE_EXTERNAL_CONNECTION
} from 'action-types';

export function createAccount(
    accountName,
    hasLoginAccess,
    password,
    hasS3Access,
    defaultResource,
    hasAccessToAllBucekts,
    allowedBuckets
) {
    return {
        type: CREATE_ACCOUNT,
        payload: {
            accountName,
            hasLoginAccess,
            password,
            hasS3Access,
            defaultResource,
            hasAccessToAllBucekts,
            allowedBuckets
        }
    };
}

export function completeCreateAccount(accountName, password) {
    return {
        type: COMPLETE_CREATE_ACCOUNT,
        payload: { accountName, password }
    };
}

export function failCreateAccount(accountName, error) {
    return {
        type: FAIL_CREATE_ACCOUNT,
        payload: { accountName, error }
    };
}

export function updateAccountS3Access(
    accountName,
    hasS3Access,
    defaultResource,
    hasAccessToAllBuckets,
    allowedBuckets
) {
    return {
        type: UPDATE_ACCOUNT_S3_ACCESS,
        payload: {
            accountName,
            hasS3Access,
            defaultResource,
            hasAccessToAllBuckets,
            allowedBuckets
        }
    };
}

export function completeUpdateAccountS3Access(accountName) {
    return {
        type: COMPLETE_UPDATE_ACCOUNT_S3_ACCESS,
        payload: { accountName }
    };
}

export function failUpdateAccountS3Access(accountName, error) {
    return {
        type: FAIL_UPDATE_ACCOUNT_S3_ACCESS,
        payload: { accountName, error }
    };
}

export function setAccountIpRestrictions(accountName, allowedIps) {
    return {
        type: SET_ACCOUNT_IP_RESTRICTIONS,
        payload: { accountName, allowedIps }
    };
}

export function completeSetAccountIpRestrictions(accountName) {
    return {
        type: COMPLETE_SET_ACCOUNT_IP_RESTRICTIONS,
        payload: { accountName }

    };
}

export function failSetAccountIpRestrictions(accountName, error) {
    return {
        type: FAIL_SET_ACCOUNT_IP_RESTRICTIONS,
        payload: { accountName, error }
    };
}

export function changeAccountPassword(
    verificationPassword,
    accountName,
    password,
    expireNewPassword = false
) {
    return {
        type: CHANGE_ACCOUNT_PASSWORD,
        payload: {
            verificationPassword,
            accountName,
            password,
            expireNewPassword
        }
    };
}

export function completeChangeAccountPassword(accountName, expireNewPassword) {
    return {
        type: COMPLETE_CHANGE_ACCOUNT_PASSWORD,
        payload: { accountName, expireNewPassword }
    };
}

export function failChangeAccountPassword(accountName, error) {
    return {
        type: FAIL_CHANGE_ACCOUNT_PASSWORD,
        payload: { accountName, error }
    };
}

export function addExternalConnection(name, service, params) {
    return {
        type: ADD_EXTERNAL_CONNECTION,
        payload: { name, service, params }
    };
}

export function completeAddExternalConnection(connection) {
    return {
        type: COMPLETE_ADD_EXTERNAL_CONNECTION,
        payload: { connection }
    };
}

export function failAddExternalConnection(connection, error) {
    return {
        type: FAIL_ADD_EXTERNAL_CONNECTION,
        payload: { connection, error }
    };
}

export function tryDeleteAccount(email, isCurrentUser, isConfirmed = false) {
    return {
        type: TRY_DELETE_ACCOUNT,
        payload: { email, isCurrentUser, isConfirmed }
    };
}

export function completeDeleteAccount(email, isCurrentUser) {
    return {
        type: COMPLETE_DELETE_ACCOUNT,
        payload: { email, isCurrentUser }
    };
}

export function failDeleteAccount(email, error) {
    return {
        type: FAIL_DELETE_ACCOUNT,
        payload: { email, error }
    };
}

export function deleteExternalConnection(connection) {
    return {
        type: DELETE_EXTERNAL_CONNECTION,
        payload: { connection }
    };
}

export function completeDeleteExternalConnection(connection) {
    return {
        type: COMPLETE_DELETE_EXTERNAL_CONNECTION,
        payload: { connection }
    };
}

export function failDeleteExternalConnection(connection, error) {
    return {
        type: FAIL_DELETE_EXTERNAL_CONNECTION,
        payload: { connection, error }
    };
}
